package app.qiban.mobile;

import static org.junit.Assert.*;

import android.graphics.Bitmap;
import android.graphics.Color;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.io.File;
import java.io.FileOutputStream;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Test APK only: exercises the real runtime bridge without enabling WebView debugging. */
@RunWith(AndroidJUnit4.class)
public class NativeBoundarySmokeTest {
  private static String evaluate(ActivityScenario<MainActivity> scenario, String script)
      throws Exception {
    String[] value = new String[1];
    CountDownLatch result = new CountDownLatch(1);
    scenario.onActivity(
        activity ->
            activity
                .getBridge()
                .getWebView()
                .evaluateJavascript(
                    script,
                    encoded -> {
                      value[0] = encoded;
                      result.countDown();
                    }));
    assertTrue("WebView evaluation timed out", result.await(10, TimeUnit.SECONDS));
    return new JSONArray("[" + value[0] + "]").getString(0);
  }

  @Test
  public void realBridgeDeniesGenericCapabilitiesAndPrivateImageRoute() throws Exception {
    try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
      for (int attempt = 0; attempt < 100; attempt++) {
        if (evaluate(scenario, "String(!!(window.Capacitor && window.Capacitor.nativePromise))")
            .equals("true")) break;
        Thread.sleep(100);
      }
      assertEquals(
          "true",
          evaluate(scenario, "String(!!(window.Capacitor && window.Capacitor.nativePromise))"));
      scenario.onActivity(
          activity -> {
            assertEquals(
                MainActivity.DeniedHttp.class,
                activity.getBridge().getPlugin("CapacitorHttp").getPluginClass());
            assertEquals(
                MainActivity.DeniedCookies.class,
                activity.getBridge().getPlugin("CapacitorCookies").getPluginClass());
            assertEquals(
                MainActivity.DeniedWebView.class,
                activity.getBridge().getPlugin("WebView").getPluginClass());
            assertEquals(
                QibanPlugin.class, activity.getBridge().getPlugin("Qiban").getPluginClass());
          });
      assertEquals(
          "undefined,undefined",
          evaluate(
              scenario,
              "String(typeof window.CapacitorHttpAndroidInterface)+','+String(typeof"
                  + " window.CapacitorCookiesAndroidInterface)"));
      String[][] calls = {
        {"CapacitorHttp", "request"},
        {"CapacitorHttp", "get"},
        {"WebView", "setServerBasePath"},
        {"WebView", "setServerAssetPath"},
        {"WebView", "persistServerBasePath"},
        {"CapacitorCookies", "setCookie"}
      };
      for (String[] call : calls) {
        evaluate(
            scenario,
            "window.__qibanBoundary='pending';window.Capacitor.nativePromise("
                + JSONObject.quote(call[0])
                + ","
                + JSONObject.quote(call[1])
                + ",{url:'http://127.0.0.1:9',path:'/synthetic/private',key:'synthetic',value:'synthetic'})"
                + ".then(()=>window.__qibanBoundary='allowed',e=>window.__qibanBoundary=String(e.message));'started'");
        assertEquals(call[0] + "." + call[1], MainActivity.DENIED_ERROR, settled(scenario));
      }
      evaluate(
          scenario,
          "window.__qibanBoundary='pending';window.Capacitor.nativePromise('Qiban','status',{})"
              + ".then(r=>window.__qibanBoundary=String(r.ok&&r.value.mode==='demo'),()=>window.__qibanBoundary='failed');'started'");
      assertEquals("true", settled(scenario));
      File[] probe = new File[1];
      scenario.onActivity(
          activity -> {
            probe[0] = new File(activity.getFilesDir(), "qiban-boundary-test.png");
            Bitmap image = Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888);
            image.eraseColor(Color.BLUE);
            try (FileOutputStream output = new FileOutputStream(probe[0])) {
              assertTrue(image.compress(Bitmap.CompressFormat.PNG, 100, output));
            } catch (Exception error) {
              throw new AssertionError(error);
            } finally {
              image.recycle();
            }
          });
      try {
        String route = "https://localhost/_capacitor_file_" + probe[0].getAbsolutePath();
        evaluate(
            scenario,
            "window.__qibanBoundary='pending';window.__qibanProbe=new Image();"
                + "window.__qibanProbe.onload=()=>window.__qibanBoundary='leaked';"
                + "window.__qibanProbe.onerror=()=>window.__qibanBoundary='blocked';window.__qibanProbe.src="
                + JSONObject.quote(route)
                + ";'started'");
        assertEquals("blocked", settled(scenario));
      } finally {
        assertTrue(probe[0].delete());
      }
    }
  }

  private static String settled(ActivityScenario<MainActivity> scenario) throws Exception {
    for (int attempt = 0; attempt < 100; attempt++) {
      String result = evaluate(scenario, "String(window.__qibanBoundary)");
      if (!result.equals("pending")) return result;
      Thread.sleep(100);
    }
    fail("Native bridge result timed out");
    return "";
  }
}
