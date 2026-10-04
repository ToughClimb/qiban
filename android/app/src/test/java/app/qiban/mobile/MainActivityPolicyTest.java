package app.qiban.mobile;

import static org.junit.Assert.*;

import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import com.getcapacitor.Bridge;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginHandle;
import com.getcapacitor.PluginMethodHandle;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.GraphicsMode;

@RunWith(RobolectricTestRunner.class)
@Config(manifest = Config.NONE, sdk = 35)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
public class MainActivityPolicyTest {
  private static WebResourceRequest request(String url) {
    return new WebResourceRequest() {
      @Override
      public Uri getUrl() {
        return Uri.parse(url);
      }

      @Override
      public boolean isForMainFrame() {
        return false;
      }

      @Override
      public boolean isRedirect() {
        return false;
      }

      @Override
      public boolean hasGesture() {
        return false;
      }

      @Override
      public String getMethod() {
        return "GET";
      }

      @Override
      public Map<String, String> getRequestHeaders() {
        return Collections.emptyMap();
      }
    };
  }

  @Test
  public void forbiddenRequestsActuallyReturn403BeforeAssetOrCapacitorAccess() {
    MainActivity activity = new MainActivity();
    for (String url :
        Arrays.asList(
            "https://localhost/_capacitor_file_/data/user/0/app.qiban.mobile/files/connection.enc",
            "https://localhost/_capacitor_content_/content://example/private",
            "https://localhost/_capacitor_http_interceptor_?u=https://example.com",
            "https://localhost/_capacitor_https_interceptor_?u=https://example.com",
            "https://localhost/%5fcapacitor_file_/private",
            "https://localhost/%255fcapacitor_file_/private",
            "https://localhost/assets/../_capacitor_file_/private",
            "https://localhost/assets/%2e%2e/private",
            "https://localhost//_capacitor_file_/private",
            "https://localhost/ASSETS/_CAPACITOR_HTTP_INTERCEPTOR_",
            "https://localhost/assets/index.js?u=https://example.com",
            "https://localhost@evil.example/assets/index.js",
            "https://localhost:444/assets/index.js",
            "http://localhost/assets/index.js",
            "file:///data/user/0/app.qiban.mobile/files/connection.enc",
            "content://example/private",
            "https://evil.example/index.html")) {
      WebResourceResponse response = activity.packagedResponse(request(url));
      assertNotNull(url, response);
      assertEquals(url, 403, response.getStatusCode());
      assertEquals(
          url,
          "default-src 'none'; frame-ancestors 'none'",
          response.getResponseHeaders().get("Content-Security-Policy"));
    }
  }

  @Test
  public void onlyCanonicalPackagedPathsAndBoundedStaticImagesRemainAllowed() {
    assertEquals("index.html", MainActivity.packagedPath("https://localhost/"));
    assertEquals("index.html", MainActivity.packagedPath("https://localhost/index.html#chat"));
    assertEquals(
        "assets/index-example.js",
        MainActivity.packagedPath("https://localhost/assets/index-example.js"));
    assertEquals(
        "characters/lin.svg",
        MainActivity.packagedPath("https://localhost:443/characters/lin.svg"));
    assertNull(MainActivity.packagedPath("https://localhost/other.html"));
    assertNull(MainActivity.packagedPath("https://localhost/assets/other.html"));
    MainActivity activity = new MainActivity();
    assertNull(
        activity.packagedResponse(request(imageUrl("png", picture(Bitmap.CompressFormat.PNG)))));
    assertEquals(
        403,
        activity.packagedResponse(request("data:text/html;base64,PHNjcmlwdD4=")).getStatusCode());
  }

  private static byte[] picture(Bitmap.CompressFormat format) {
    Bitmap image = Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888);
    image.eraseColor(Color.BLUE);
    try (ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
      assertTrue(image.compress(format, 90, bytes));
      return bytes.toByteArray();
    } catch (IOException error) {
      throw new AssertionError(error);
    } finally {
      image.recycle();
    }
  }

  private static String imageUrl(String format, byte[] bytes) {
    return "data:image/"
        + format
        + ";base64,"
        + android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP);
  }

  @Test
  public void imagePreviewsPermitOnlyBoundedStaticRasterData() {
    MainActivity activity = new MainActivity();
    String png = imageUrl("png", picture(Bitmap.CompressFormat.PNG));
    String jpeg = imageUrl("jpeg", picture(Bitmap.CompressFormat.JPEG));
    String webp = imageUrl("webp", picture(Bitmap.CompressFormat.WEBP_LOSSLESS));
    for (String image : Arrays.asList(png, jpeg, webp)) {
      assertTrue(MainActivity.inlineImage(image));
      assertNull(activity.packagedResponse(request(image)));
      assertNull(MainActivity.packagedPath(image));
    }
    for (String invalid :
        Arrays.asList(
            imageUrl("jpeg", picture(Bitmap.CompressFormat.PNG)),
            imageUrl("png", new byte[] {1, 2, 3}),
            imageUrl("jpeg", new byte[1024 * 1024 + 1]),
            "data:image/svg+xml;base64,PHN2Zz4=",
            "data:image/gif;base64,R0lGODlh",
            "data:text/html;base64,PHNjcmlwdD4=",
            jpeg.substring(0, jpeg.length() - 1),
            png + "?url=https://example.com")) {
      assertFalse(MainActivity.inlineImage(invalid));
      assertEquals(403, activity.packagedResponse(request(invalid)).getStatusCode());
    }
    byte[] original = picture(Bitmap.CompressFormat.PNG), apng = new byte[original.length + 20];
    System.arraycopy(original, 0, apng, 0, 33);
    java.nio.ByteBuffer.wrap(apng, 33, 4).putInt(8);
    System.arraycopy("acTL".getBytes(StandardCharsets.US_ASCII), 0, apng, 37, 4);
    System.arraycopy(original, 33, apng, 53, original.length - 33);
    assertFalse(MainActivity.inlineImage(imageUrl("png", apng)));
    original = picture(Bitmap.CompressFormat.WEBP_LOSSLESS);
    byte[] animatedWebp = Arrays.copyOf(original, original.length + 8);
    System.arraycopy(
        "ANIM".getBytes(StandardCharsets.US_ASCII), 0, animatedWebp, original.length, 4);
    java.nio.ByteBuffer.wrap(animatedWebp, 4, 4)
        .order(java.nio.ByteOrder.LITTLE_ENDIAN)
        .putInt(animatedWebp.length - 8);
    assertFalse(MainActivity.inlineImage(imageUrl("webp", animatedWebp)));
  }

  @Test
  public void originResetTargetsOnlyTheFixedAppDocument() {
    assertTrue(OriginStorageReset.targetDocument("https://localhost/"));
    assertTrue(OriginStorageReset.targetDocument("https://localhost/index.html#settings"));
    assertTrue(OriginStorageReset.targetDocument("https://localhost:443/"));
    for (String url :
        Arrays.asList(
            "https://example.com/",
            "http://localhost/",
            "https://localhost/assets/index.js",
            "https://localhost/?origin=https://example.com",
            "https://localhost/%69ndex.html",
            "file:///private/index.html")) assertFalse(OriginStorageReset.targetDocument(url));
  }

  @Test
  public void trustedInlineBootstrapReceivesItsExactHashWithoutUnsafeInlineScripts()
      throws Exception {
    String html =
        "<html><head><script>window.test = true;</script><script type=\"module\""
            + " src=\"/assets/index.js\"></script></head></html>";
    String csp = MainActivity.htmlCsp(html);
    String scripts = csp.substring(csp.indexOf("script-src"), csp.indexOf("; style-src"));
    assertEquals(
        "script-src 'self' 'sha256-c9bvjtI1ZrwVU2kYp402UsCD1XFCusmDJMiwtYTNgB4='", scripts);
    assertFalse(scripts.contains("unsafe-inline"));
    assertTrue(csp.contains("connect-src 'none'"));
    assertTrue(csp.contains("worker-src 'none'"));
    assertTrue(csp.contains("frame-src 'none'"));
  }

  @Test
  public void htmlFailuresAndOversizeResponsesFailClosed() throws Exception {
    assertThrows(IOException.class, () -> MainActivity.htmlCsp("<html><script>unfinished"));
    assertThrows(
        IOException.class, () -> MainActivity.htmlText(new byte[] {(byte) 0xc3, (byte) 0x28}));
    assertThrows(
        IOException.class,
        () ->
            MainActivity.boundedHtml(
                new ByteArrayInputStream(new byte[MainActivity.MAX_HTML_BYTES + 1])));
    assertEquals(
        "one\ntwo\nthree",
        MainActivity.htmlText("one\r\ntwo\rthree".getBytes(StandardCharsets.UTF_8)));
  }

  private static class RecordingCall extends PluginCall {
    String rejected;

    RecordingCall(String plugin, String method) {
      super(
          null,
          plugin,
          "synthetic-test",
          method,
          new JSObject().put("url", "https://example.com").put("path", "/synthetic/private"));
    }

    @Override
    public void reject(String message) {
      rejected = message;
    }
  }

  private static PluginHandle methodHandle(Plugin plugin) throws Exception {
    // Use Capacitor's actual method indexing and invoke dispatcher without registering Android
    // permission/activity launchers, which require a live Bridge and are unrelated to denial.
    Constructor<PluginHandle> metadata =
        PluginHandle.class.getDeclaredConstructor(Class.class, Bridge.class);
    metadata.setAccessible(true);
    PluginHandle handle = metadata.newInstance(plugin.getClass(), null);
    Field instance = PluginHandle.class.getDeclaredField("instance");
    instance.setAccessible(true);
    instance.set(handle, plugin);
    return handle;
  }

  @Test
  public void allForbiddenCoreCallsInvokeRealHandlesAndRejectWithFixedError() throws Exception {
    assertDenied(
        new MainActivity.DeniedHttp(),
        "CapacitorHttp",
        "request",
        "get",
        "post",
        "put",
        "patch",
        "delete");
    assertDenied(
        new MainActivity.DeniedCookies(),
        "CapacitorCookies",
        "getCookies",
        "setCookie",
        "deleteCookie",
        "clearCookies",
        "clearAllCookies");
    assertDenied(
        new MainActivity.DeniedWebView(),
        "WebView",
        "setServerAssetPath",
        "setServerBasePath",
        "getServerBasePath",
        "persistServerBasePath");
  }

  private static void assertDenied(Plugin plugin, String id, String... methods) throws Exception {
    PluginHandle handle = methodHandle(plugin);
    assertEquals(id, handle.getId());
    Set<String> indexed = new HashSet<>();
    for (PluginMethodHandle method : handle.getMethods()) indexed.add(method.getName());
    for (String method : methods) {
      assertTrue(method, indexed.contains(method));
      RecordingCall call = new RecordingCall(id, method);
      handle.invoke(method, call);
      assertEquals(id + "." + method, MainActivity.DENIED_ERROR, call.rejected);
    }
    for (String method :
        Arrays.asList(
            "addListener",
            "removeListener",
            "removeAllListeners",
            "checkPermissions",
            "requestPermissions")) {
      RecordingCall call = new RecordingCall(id, method);
      handle.invoke(method, call);
      assertEquals(MainActivity.DENIED_ERROR, call.rejected);
    }
  }
}
