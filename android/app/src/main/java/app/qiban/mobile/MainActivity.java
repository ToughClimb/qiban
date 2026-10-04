package app.qiban.mobile;

import android.net.Uri;
import android.os.Bundle;
import android.webkit.*;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import com.getcapacitor.BridgeWebViewClient;
import java.io.ByteArrayInputStream;

public class MainActivity extends BridgeActivity {
  private static boolean local(Uri uri) {
    return "https".equals(uri.getScheme())
        && "localhost".equals(uri.getHost())
        && (uri.getPort() == -1 || uri.getPort() == 443);
  }

  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(QibanPlugin.class);
    super.onCreate(savedInstanceState);
    WebView.setWebContentsDebuggingEnabled(false);
    WebSettings settings = bridge.getWebView().getSettings();
    settings.setAllowFileAccess(false);
    settings.setAllowContentAccess(false);
    settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
    settings.setJavaScriptCanOpenWindowsAutomatically(false);
    settings.setSupportMultipleWindows(true);
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
            return !request.isForMainFrame() || !local(request.getUrl());
          }

          @Override
          public boolean shouldOverrideUrlLoading(WebView view, String url) {
            return !local(Uri.parse(url));
          }

          @Override
          public WebResourceResponse shouldInterceptRequest(
              WebView view, WebResourceRequest request) {
            if (!local(request.getUrl()))
              return new WebResourceResponse(
                  "text/plain",
                  "UTF-8",
                  403,
                  "Forbidden",
                  java.util.Collections.emptyMap(),
                  new ByteArrayInputStream(new byte[0]));
            WebResourceResponse response = super.shouldInterceptRequest(view, request);
            if (response != null) {
              java.util.Map<String, String> headers = new java.util.HashMap<>();
              if (response.getResponseHeaders() != null)
                headers.putAll(response.getResponseHeaders());
              headers.put(
                  "Content-Security-Policy",
                  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src"
                      + " 'self' data:; connect-src 'none'; frame-src 'none'; object-src 'none';"
                      + " base-uri 'none'");
              response.setResponseHeaders(headers);
            }
            return response;
          }
        });
  }
}
