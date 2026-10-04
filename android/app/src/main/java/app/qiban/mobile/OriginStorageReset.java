package app.qiban.mobile;

import android.os.Handler;
import android.os.Looper;
import android.webkit.ValueCallback;
import android.webkit.WebStorage;
import android.webkit.WebView;
import java.util.concurrent.atomic.AtomicBoolean;

/** Fixed app-origin erasure; no navigation, caller-provided script, origin, key or path. */
public final class OriginStorageReset {
  static final String APP_ORIGIN = "https://localhost";
  private static final long TIMEOUT_MS = 10000;
  private static final String RESET_SCRIPT =
      "(()=>{try{if(window!==window.top||location.origin!=='https://localhost')return false;const"
          + " local=window.localStorage,session=window.sessionStorage;let"
          + " state=window.__qibanOriginStorageReset;if(!state){const"
          + " original=Storage.prototype.setItem;const"
          + " gate=function(key,value){if(this===local)throw new DOMException('Storage has been"
          + " cleared','InvalidStateError');return original.call(this,key,value);};"
          + "Object.defineProperty(Storage.prototype,'setItem',{value:gate,writable:false,configurable:false});"
          + "state=Object.freeze({local,gate});"
          + "Object.defineProperty(window,'__qibanOriginStorageReset',{value:state,writable:false,configurable:false});}if(state.local!==local||Storage.prototype.setItem!==state.gate)return"
          + " false;local.clear();session.clear();return"
          + " local.length===0&&session.length===0;}catch(_){return false;}})()";
  private static final String VERIFY_SCRIPT =
      "(()=>{try{if(window!==window.top||location.origin!=='https://localhost')return false;const"
          + " state=window.__qibanOriginStorageReset;return"
          + " !!state&&state.local===window.localStorage&&Storage.prototype.setItem===state.gate&&window.localStorage.length===0&&window.sessionStorage.length===0;}catch(_){return"
          + " false;}})()";

  private OriginStorageReset() {}

  static boolean targetDocument(String url) {
    return "index.html".equals(MainActivity.packagedPath(url));
  }

  private static String documentUrl(WebView view) {
    try {
      return view == null ? null : view.getUrl();
    } catch (RuntimeException error) {
      return null;
    }
  }

  /** Callback runs on the main thread; true means this same app document was verified empty. */
  public static void clear(WebView view, ValueCallback<Boolean> callback) {
    Handler main = new Handler(Looper.getMainLooper());
    Runnable action = () -> clearOnUiThread(view, callback, main);
    if (Looper.myLooper() == Looper.getMainLooper()) action.run();
    else main.post(action);
  }

  private static void clearOnUiThread(WebView view, ValueCallback<Boolean> callback, Handler main) {
    AtomicBoolean completed = new AtomicBoolean();
    Runnable timeout =
        () -> {
          if (completed.compareAndSet(false, true)) callback.onReceiveValue(false);
        };
    ValueCallback<Boolean> finish =
        success -> {
          if (completed.compareAndSet(false, true)) {
            main.removeCallbacks(timeout);
            callback.onReceiveValue(success);
          }
        };
    String documentUrl = documentUrl(view);
    if (!targetDocument(documentUrl)) {
      finish.onReceiveValue(false);
      return;
    }
    main.postDelayed(timeout, TIMEOUT_MS);
    try {
      view.evaluateJavascript(
          RESET_SCRIPT,
          result -> {
            if (completed.get()) return;
            if (!"true".equals(result) || !documentUrl.equals(documentUrl(view))) {
              finish.onReceiveValue(false);
              return;
            }
            try {
              WebStorage.getInstance().deleteOrigin(APP_ORIGIN);
              view.evaluateJavascript(
                  VERIFY_SCRIPT,
                  verified ->
                      finish.onReceiveValue(
                          "true".equals(verified) && documentUrl.equals(documentUrl(view))));
            } catch (RuntimeException error) {
              finish.onReceiveValue(false);
            }
          });
    } catch (RuntimeException error) {
      finish.onReceiveValue(false);
    }
  }
}
