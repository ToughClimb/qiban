package app.qiban.mobile;

import android.os.Bundle;
import android.webkit.*;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import com.getcapacitor.BridgeWebViewClient;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.*;
import java.net.URI;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.regex.*;

public class MainActivity extends BridgeActivity {
  static final int MAX_HTML_BYTES = 2 * 1024 * 1024;
  private static final Pattern SCRIPT =
      Pattern.compile(
          "<script\\b([^>]*)>(.*?)</script\\s*>", Pattern.CASE_INSENSITIVE | Pattern.DOTALL);
  private static final Pattern SCRIPT_OPEN =
      Pattern.compile("<script\\b", Pattern.CASE_INSENSITIVE);
  private static final Pattern SCRIPT_SRC =
      Pattern.compile("(?:^|\\s)src\\s*=", Pattern.CASE_INSENSITIVE);
  private static final String CSP_SUFFIX =
      "; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; frame-src"
          + " 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

  /** Only canonical, packaged resource names are accepted, before Capacitor sees the URL. */
  static String packagedPath(String url) {
    try {
      URI uri = new URI(url);
      if (!"https".equals(uri.getScheme())
          || !("localhost".equals(uri.getRawAuthority())
              || "localhost:443".equals(uri.getRawAuthority()))
          || uri.getRawQuery() != null) return null;
      String path = uri.getRawPath();
      if (path == null || path.isEmpty() || path.equals("/")) return "index.html";
      // Reject every encoded path, backslash, dot segment and Capacitor reserved route.
      // Packaged Vite resources have plain ASCII filenames; no decoding is needed.
      if (!path.matches("/[a-zA-Z0-9_./-]+")
          || path.toLowerCase(Locale.ROOT).contains("_capacitor_")) return null;
      for (String part : path.substring(1).split("/", -1))
        if (part.isEmpty() || part.equals(".") || part.equals("..")) return null;
      if (path.equals("/index.html")
          || path.equals("/qiban.svg")
          || path.equals("/cordova.js")
          || path.equals("/cordova_plugins.js")) return path.substring(1);
      if ((path.startsWith("/assets/") || path.startsWith("/characters/"))
          && !path.toLowerCase(Locale.ROOT).endsWith(".html")) return path.substring(1);
    } catch (Exception ignored) {
      // Malformed and ambiguous URLs fail closed without logging user-controlled text.
    }
    return null;
  }

  static byte[] boundedHtml(InputStream input) throws IOException {
    try (InputStream source = input;
        ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
      if (source == null) throw new IOException();
      byte[] buffer = new byte[8192];
      int count;
      while ((count = source.read(buffer)) != -1) {
        if (bytes.size() + count > MAX_HTML_BYTES) throw new IOException();
        bytes.write(buffer, 0, count);
      }
      return bytes.toByteArray();
    }
  }

  static String htmlText(byte[] bytes) throws IOException {
    try {
      // HTML normalizes CR/LF before interpreting script text; serve this same normalization.
      return StandardCharsets.UTF_8
          .newDecoder()
          .decode(ByteBuffer.wrap(bytes))
          .toString()
          .replace("\r\n", "\n")
          .replace('\r', '\n');
    } catch (Exception error) {
      throw new IOException();
    }
  }

  static String htmlCsp(String trustedHtml) throws IOException {
    StringBuilder scripts = new StringBuilder("default-src 'self'; script-src 'self'");
    Matcher tags = SCRIPT.matcher(trustedHtml);
    int matched = 0;
    Set<String> hashes = new LinkedHashSet<>();
    try {
      while (tags.find()) {
        matched++;
        if (!SCRIPT_SRC.matcher(tags.group(1)).find()) {
          byte[] digest =
              MessageDigest.getInstance("SHA-256")
                  .digest(tags.group(2).getBytes(StandardCharsets.UTF_8));
          hashes.add(android.util.Base64.encodeToString(digest, android.util.Base64.NO_WRAP));
        }
      }
      Matcher openings = SCRIPT_OPEN.matcher(trustedHtml);
      int opened = 0;
      while (openings.find()) opened++;
      if (opened != matched) throw new IOException();
      for (String hash : hashes) scripts.append(" 'sha256-").append(hash).append("'");
      return scripts.append(CSP_SUFFIX).toString();
    } catch (Exception error) {
      throw new IOException();
    }
  }

  static WebResourceResponse deniedResponse() {
    return new WebResourceResponse(
        "text/plain",
        "UTF-8",
        403,
        "Forbidden",
        Collections.singletonMap(
            "Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'"),
        new ByteArrayInputStream(new byte[0]));
  }

  WebResourceResponse packagedResponse(WebResourceRequest request) {
    String url = request.getUrl().toString();
    // Bounded PNG data URLs are the native avatar representation; CSP restricts them to images.
    if (!request.isForMainFrame() && "GET".equals(request.getMethod()) && inlinePng(url))
      return null;
    String path = packagedPath(url);
    if (path == null
        || !"GET".equals(request.getMethod())
        || (request.isForMainFrame() && !"index.html".equals(path))) return deniedResponse();
    try {
      // Never delegate path handling/proxying to WebViewLocalServer. Its only use here is
      // bootstrap injection into the fixed APK index, unaffected by serverBasePath changes.
      InputStream source = getAssets().open("public/" + path);
      String csp = "default-src 'self'; script-src 'self'" + CSP_SUFFIX;
      String mime;
      if (path.equals("index.html")) {
        try (InputStream original = source) {
          String html =
              htmlText(
                  boundedHtml(
                      bridge
                          .getLocalServer()
                          .getJavaScriptInjectedStream(
                              new ByteArrayInputStream(boundedHtml(original)))));
          csp = htmlCsp(html);
          source = new ByteArrayInputStream(html.getBytes(StandardCharsets.UTF_8));
        }
        mime = "text/html";
      } else if (path.endsWith(".js")) mime = "application/javascript";
      else if (path.endsWith(".css")) mime = "text/css";
      else if (path.endsWith(".svg")) mime = "image/svg+xml";
      else {
        mime =
            MimeTypeMap.getSingleton()
                .getMimeTypeFromExtension(MimeTypeMap.getFileExtensionFromUrl(path));
        if (mime == null) mime = "application/octet-stream";
      }
      Map<String, String> headers = new HashMap<>();
      headers.put("Content-Security-Policy", csp);
      headers.put("X-Content-Type-Options", "nosniff");
      headers.put("Cache-Control", "no-store");
      return new WebResourceResponse(mime, "UTF-8", 200, "OK", headers, source);
    } catch (Exception ignored) {
      return deniedResponse();
    }
  }

  static final String DENIED_ERROR = "此功能不可用。";

  static boolean inlinePng(String url) {
    return url.length() <= 1400000
        && url.matches("data:image/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}");
  }

  /** Known core calls reject explicitly; none retains filesystem/network/cookie authority. */
  public abstract static class DeniedCorePlugin extends Plugin {
    @Override
    @PluginMethod
    public void addListener(PluginCall call) {
      call.reject(DENIED_ERROR);
    }

    @Override
    @PluginMethod
    public void removeListener(PluginCall call) {
      call.reject(DENIED_ERROR);
    }

    @Override
    @PluginMethod
    public void removeAllListeners(PluginCall call) {
      call.reject(DENIED_ERROR);
    }

    @Override
    @PluginMethod
    public void checkPermissions(PluginCall call) {
      call.reject(DENIED_ERROR);
    }

    @Override
    @PluginMethod
    public void requestPermissions(PluginCall call) {
      call.reject(DENIED_ERROR);
    }
  }

  @CapacitorPlugin(name = "CapacitorHttp")
  public static class DeniedHttp extends DeniedCorePlugin {
    @Override
    public void load() {
      if (getBridge() != null)
        getBridge().getWebView().removeJavascriptInterface("CapacitorHttpAndroidInterface");
    }

    @PluginMethod
    public void request(PluginCall call) {
      call.reject(DENIED_ERROR);
    }

    @PluginMethod
    public void get(PluginCall call) {
      call.reject(DENIED_ERROR);
    }

    @PluginMethod
    public void post(PluginCall call) {
      call.reject(DENIED_ERROR);
    }

    @PluginMethod
    public void put(PluginCall call) {
      call.reject(DENIED_ERROR);
    }

    @PluginMethod
    public void patch(PluginCall call) {
      call.reject(DENIED_ERROR);
    }

    @PluginMethod
    public void delete(PluginCall call) {
      call.reject(DENIED_ERROR);
    }
  }

  @CapacitorPlugin(name = "CapacitorCookies")
  public static class DeniedCookies extends DeniedCorePlugin {
    @Override
    public void load() {
      if (getBridge() != null)
        getBridge().getWebView().removeJavascriptInterface("CapacitorCookiesAndroidInterface");
    }

    @PluginMethod
    public void getCookies(PluginCall call) {
      call.reject(DENIED_ERROR);
    }

    @PluginMethod
    public void setCookie(PluginCall call) {
      call.reject(DENIED_ERROR);
    }

    @PluginMethod
    public void deleteCookie(PluginCall call) {
      call.reject(DENIED_ERROR);
    }

    @PluginMethod
    public void clearCookies(PluginCall call) {
      call.reject(DENIED_ERROR);
    }

    @PluginMethod
    public void clearAllCookies(PluginCall call) {
      call.reject(DENIED_ERROR);
    }
  }

  @CapacitorPlugin(name = "WebView")
  public static class DeniedWebView extends DeniedCorePlugin {
    @PluginMethod
    public void setServerAssetPath(PluginCall call) {
      call.reject(DENIED_ERROR);
    }

    @PluginMethod
    public void setServerBasePath(PluginCall call) {
      call.reject(DENIED_ERROR);
    }

    @PluginMethod
    public void getServerBasePath(PluginCall call) {
      call.reject(DENIED_ERROR);
    }

    @PluginMethod
    public void persistServerBasePath(PluginCall call) {
      call.reject(DENIED_ERROR);
    }
  }

  @Override
  public void onCreate(Bundle savedInstanceState) {
    // Bridge registers core plugins first, then these initial plugins overwrite their handles
    // before bootstrap generation and the first load. Re-register after construction too.
    registerPlugin(QibanPlugin.class);
    registerPlugin(DeniedHttp.class);
    registerPlugin(DeniedCookies.class);
    registerPlugin(DeniedWebView.class);
    super.onCreate(savedInstanceState);
    if (bridge == null) return;
    bridge.registerPlugin(DeniedHttp.class);
    bridge.registerPlugin(DeniedCookies.class);
    bridge.registerPlugin(DeniedWebView.class);
    WebView.setWebContentsDebuggingEnabled(false);
    WebSettings settings = bridge.getWebView().getSettings();
    settings.setAllowFileAccess(false);
    settings.setAllowContentAccess(false);
    settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
    settings.setJavaScriptCanOpenWindowsAutomatically(false);
    settings.setSupportMultipleWindows(true);
    ServiceWorkerController workers = ServiceWorkerController.getInstance();
    workers.getServiceWorkerWebSettings().setAllowContentAccess(false);
    workers.getServiceWorkerWebSettings().setAllowFileAccess(false);
    workers.getServiceWorkerWebSettings().setBlockNetworkLoads(true);
    workers.setServiceWorkerClient(
        new ServiceWorkerClient() {
          @Override
          public WebResourceResponse shouldInterceptRequest(WebResourceRequest request) {
            return deniedResponse();
          }
        });
    bridge
        .getWebView()
        .setWebChromeClient(
            new BridgeWebChromeClient(bridge) {
              @Override
              public boolean onCreateWindow(
                  WebView view, boolean dialog, boolean gesture, android.os.Message resultMsg) {
                return false;
              }
            });
    bridge.setWebViewClient(
        new BridgeWebViewClient(bridge) {
          @Override
          public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return !request.isForMainFrame()
                || !"index.html".equals(packagedPath(request.getUrl().toString()));
          }

          @Override
          public boolean shouldOverrideUrlLoading(WebView view, String url) {
            return !"index.html".equals(packagedPath(url));
          }

          @Override
          public WebResourceResponse shouldInterceptRequest(
              WebView view, WebResourceRequest request) {
            return packagedResponse(request);
          }
        });
    // Reload under our client so the first displayed document always receives the policy.
    bridge.getWebView().stopLoading();
    bridge.getWebView().loadUrl("https://localhost/");
  }
}
