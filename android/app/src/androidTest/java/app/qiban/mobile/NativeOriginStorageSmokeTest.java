package app.qiban.mobile;

import static app.qiban.mobile.NativeBoundarySmokeTest.*;
import static org.junit.Assert.*;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public final class NativeOriginStorageSmokeTest {
  static void awaitAndroidSettings(ActivityScenario<MainActivity> scenario) throws Exception {
    awaitBridge(scenario);
    for (int attempt = 0; attempt < 100; attempt++) {
      if (evaluate(
              scenario,
              "String(window.qibanPlatform==='android'&&!!document.querySelector('#android-api-url')&&!!document.querySelector('.appearance-options'))")
          .equals("true")) return;
      Thread.sleep(100);
    }
    fail("Actual Android settings and shared appearance control did not mount");
  }

  @Test
  public void nativeWipeClearsAppearanceAndRejectsOldDocumentRestoration() throws Exception {
    try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
      awaitAndroidSettings(scenario);
      assertEquals(
          "true",
          evaluate(
              scenario,
              "document.querySelector('.appearance-options > summary').click();"
                  + "document.querySelector('[aria-label=\"莓红主题色\"]').click();"
                  + "String(JSON.parse(localStorage.getItem('qiban.appearance.v1')).accent==='#915669'"
                  + "&&document.documentElement.style.getPropertyValue('--accent')!=='#415d4d'"
                  + "&&!document.querySelector('input[type=password]'))"));
      String selectedAccent =
          evaluate(scenario, "document.documentElement.style.getPropertyValue('--accent')");
      scenario.recreate();
      awaitAndroidSettings(scenario);
      assertEquals(
          selectedAccent,
          evaluate(scenario, "document.documentElement.style.getPropertyValue('--accent')"));
      assertEquals(
          "true",
          evaluate(
              scenario,
              "String(document.querySelector('[aria-label=\"莓红主题色\"]').getAttribute('aria-pressed')==='true')"));
      assertEquals(
          "seeded",
          evaluate(scenario, "sessionStorage.setItem('synthetic-session','old');'seeded'"));
      evaluate(
          scenario,
          "window.__qibanBoundary='pending';window.Capacitor.nativePromise('Qiban','deleteData',{}).then(r=>{let"
              + " blocked=false;try{localStorage.setItem('qiban.appearance.v1','stale')}catch(e){blocked=e.name==='InvalidStateError'}"
              + "window.__qibanBoundary=String(r.ok&&blocked&&localStorage.length===0&&sessionStorage.length===0)},"
              + "()=>window.__qibanBoundary='failed');'started'");
      assertEquals("true", settled(scenario));
      // A later queued effect in this same realm cannot restore the erased appearance.
      evaluate(
          scenario,
          "window.__qibanBoundary='pending';setTimeout(()=>{try{Storage.prototype.setItem.call(localStorage,'qiban.appearance.v1','late')}catch(_){}"
              + "window.__qibanBoundary=String(localStorage.getItem('qiban.appearance.v1')===null)},10);'started'");
      assertEquals("true", settled(scenario));
      scenario.onActivity(activity -> activity.getBridge().getWebView().reload());
      // Wait for a new realm rather than mistaking the old page's still-ready bridge for reload.
      for (int attempt = 0; attempt < 100; attempt++) {
        if (evaluate(scenario, "String(!window.__qibanOriginStorageReset && !!window.Capacitor)")
            .equals("true")) break;
        Thread.sleep(100);
      }
      awaitAndroidSettings(scenario);
      assertEquals(
          "true",
          evaluate(
              scenario,
              "String(localStorage.getItem('qiban.appearance.v1')===null&&!window.__qibanOriginStorageReset"
                  + "&&document.documentElement.style.getPropertyValue('--accent')==='#415d4d'"
                  + "&&document.querySelector('[aria-label=\"松绿主题色\"]').getAttribute('aria-pressed')==='true')"));
      assertEquals(
          "fresh",
          evaluate(
              scenario,
              "localStorage.setItem('qiban.appearance.v1','fresh');String(localStorage.getItem('qiban.appearance.v1'))"));
      evaluate(scenario, "localStorage.removeItem('qiban.appearance.v1');'cleaned'");
    }
  }
}
