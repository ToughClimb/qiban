package app.qiban.mobile;

import static app.qiban.mobile.NativeBoundarySmokeTest.*;
import static org.junit.Assert.*;

import android.app.Activity;
import android.content.Intent;
import androidx.activity.result.ActivityResult;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Fresh test AVD only. Synthetic picker bytes and serialization never invoke a provider. */
@RunWith(AndroidJUnit4.class)
public final class NativeImageChatSmokeTest {
  private static final class RecordingCall extends PluginCall {
    final CountDownLatch completed = new CountDownLatch(1);
    JSObject result;

    RecordingCall() {
      super(
          null,
          "Qiban",
          "synthetic-image-picker",
          "pickChatImage",
          new JSObject().put("characterId", "lin"));
    }

    @Override
    public void resolve(JSObject value) {
      result = value;
      completed.countDown();
    }

    JSObject await() throws Exception {
      assertTrue("Synthetic picker callback timed out", completed.await(20, TimeUnit.SECONDS));
      return result;
    }
  }

  private static Object field(Object instance, String name) throws Exception {
    Field value = instance.getClass().getDeclaredField(name);
    value.setAccessible(true);
    return value.get(instance);
  }

  private static void setField(Object instance, String name, Object value) throws Exception {
    Field target = instance.getClass().getDeclaredField(name);
    target.setAccessible(true);
    target.set(instance, value);
  }

  private static RecordingCall pickerResult(
      QibanPlugin plugin, ChatImageStore store, long generation, int result) throws Exception {
    // Exercise the same saved picker state and callback used by ACTION_OPEN_DOCUMENT;
    // reflection remains in the instrumentation APK, with no production test bridge.
    setField(plugin, "pendingChatImageOwner", "lin");
    setField(plugin, "pendingChatImageGeneration", generation);
    RecordingCall call = new RecordingCall();
    Method callback =
        QibanPlugin.class.getDeclaredMethod(
            "chatImageResult", PluginCall.class, ActivityResult.class);
    callback.setAccessible(true);
    callback.invoke(
        plugin,
        call,
        new ActivityResult(result, new Intent().setData(SyntheticImageProvider.PIXEL)));
    call.await();
    return call;
  }

  private static void nativeCall(
      ActivityScenario<MainActivity> scenario, String method, JSONObject data) throws Exception {
    evaluate(
        scenario,
        "window.__qibanBoundary='pending';window.Capacitor.nativePromise('Qiban',"
            + JSONObject.quote(method)
            + ","
            + data
            + ").then(r=>window.__qibanBoundary=JSON.stringify(r),()=>window.__qibanBoundary='failed');'started'");
  }

  @Test
  public void syntheticPickerPersistsReferencesSerializesLocallyAndCleansScopedImages()
      throws Exception {
    try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
      NativeOriginStorageSmokeTest.awaitAndroidSettings(scenario);
      QibanPlugin[] holder = new QibanPlugin[1];
      scenario.onActivity(
          activity ->
              holder[0] = (QibanPlugin) activity.getBridge().getPlugin("Qiban").getInstance());
      QibanPlugin plugin = holder[0];
      scenario.onActivity(
          activity -> {
            try (java.io.InputStream pixel =
                activity.getContentResolver().openInputStream(SyntheticImageProvider.PIXEL)) {
              assertNotNull("Test-only provider must be visible to the target debug app", pixel);
              assertEquals("Synthetic PNG signature", 137, pixel.read());
            } catch (Exception error) {
              throw new AssertionError("Synthetic provider read failed", error);
            }
          });
      ChatImageStore store = (ChatImageStore) field(plugin, "chatImages");
      ConnectionService connection = (ConnectionService) field(plugin, "connection");
      assertEquals("demo", connection.status().getString("mode"));
      assertTrue(
          pickerResult(plugin, store, store.generation("lin"), Activity.RESULT_CANCELED)
              .result
              .isNull("value"));
      RecordingCall selected =
          pickerResult(plugin, store, store.generation("lin"), Activity.RESULT_OK);
      assertTrue(
          "Synthetic picker selection: " + selected.result.optString("error"),
          selected.result.getBoolean("ok"));
      JSONObject draft = selected.result.getJSONObject("value"),
          image = draft.getJSONObject("image");
      String imageId = image.getString("id"), preview = draft.getString("previewUrl");
      assertTrue(preview.startsWith("data:image/jpeg;base64,/9j/"));
      assertEquals(5, image.length());
      assertEquals(1, image.getInt("width"));
      assertEquals(1, image.getInt("height"));
      assertEquals("demo", connection.status().getString("mode"));
      assertThrows(IllegalArgumentException.class, () -> store.resolve("tao", image));
      // Preview is an actual renderer image, with the native policy still blocking remote routes.
      evaluate(
          scenario,
          "window.__qibanBoundary='pending';window.__qibanImage=new Image();"
              + "window.__qibanImage.onload=()=>window.__qibanBoundary='loaded';window.__qibanImage.onerror=()=>window.__qibanBoundary='failed';"
              + "window.__qibanImage.src="
              + JSONObject.quote(preview)
              + ";'started'");
      assertEquals("loaded", settled(scenario));
      // A concurrent empty-history save must preserve the active, not-yet-sent draft.
      nativeCall(scenario, "saveHistory", new JSONObject().put("history", new JSONObject()));
      assertTrue(new JSONObject(settled(scenario)).getBoolean("ok"));
      assertNotNull(store.preview("lin", imageId));
      JSONObject request =
          new JSONObject()
              .put("characterId", "lin")
              .put(
                  "messages",
                  new JSONArray()
                      .put(
                          new JSONObject()
                              .put("role", "user")
                              .put("content", "看看这张合成测试图")
                              .put("image", image)));
      JSONObject persona = new JSONObject();
      for (String key :
          new String[] {
            "name", "description", "personality", "scenario", "firstMessage", "exampleDialogue"
          }) persona.put(key, "原创测试角色");
      ConnectionService.PreparedImageRequest prepared =
          ConnectionService.prepareImageModelRequest(
              request,
              persona,
              "deepseek-flash",
              true,
              store::resolve,
              new NativeHttp.Cancellation());
      JSONObject message = prepared.body.getJSONArray("messages").getJSONObject(3);
      JSONArray parts = message.getJSONArray("content");
      assertEquals("user", message.getString("role"));
      assertEquals("text", parts.getJSONObject(0).getString("type"));
      assertEquals("看看这张合成测试图", parts.getJSONObject(0).getString("text"));
      assertEquals("image_url", parts.getJSONObject(1).getString("type"));
      assertEquals(preview, parts.getJSONObject(1).getJSONObject("image_url").getString("url"));
      assertEquals(
          "original", parts.getJSONObject(1).getJSONObject("image_url").getString("detail"));
      assertFalse(prepared.body.toString().contains(imageId));
      assertEquals(0, prepared.omittedImageIds.length());
      assertEquals("demo", connection.status().getString("mode"));
      // Exercise the actual save bridge while a synthetic reply token is pending.
      JSONArray full = new JSONArray();
      for (int i = 0; i < 200; i++)
        full.put(
            new JSONObject()
                .put("id", "rolling-" + i)
                .put("role", i % 2 == 0 ? "user" : "assistant")
                .put("content", "合成记录"));
      nativeCall(
          scenario,
          "saveHistory",
          new JSONObject().put("history", new JSONObject().put("lin", full)));
      assertTrue(new JSONObject(settled(scenario)).getBoolean("ok"));
      @SuppressWarnings("unchecked")
      java.util.Map<String, NativeHttp.Cancellation> active =
          (java.util.Map<String, NativeHttp.Cancellation>) field(connection, "active");
      NativeHttp.Cancellation syntheticReply = new NativeHttp.Cancellation();
      synchronized (connection) {
        active.put("synthetic-rollover-reply", syntheticReply);
      }
      JSONArray rolled = new JSONArray();
      for (int i = 2; i < full.length(); i++) rolled.put(full.getJSONObject(i));
      rolled.put(
          new JSONObject()
              .put("id", "rolling-image-user")
              .put("role", "user")
              .put("content", "")
              .put("image", image));
      long beforeRollover = store.generation("lin");
      nativeCall(
          scenario,
          "saveHistory",
          new JSONObject().put("history", new JSONObject().put("lin", rolled)));
      assertTrue(new JSONObject(settled(scenario)).getBoolean("ok"));
      assertFalse(
          "Oldest-turn pruning must not cancel the pending reply", syntheticReply.cancelled);
      assertEquals(beforeRollover, store.generation("lin"));
      assertNotNull(store.preview("lin", imageId));
      rolled.put(
          new JSONObject()
              .put("id", "rolling-image-reply")
              .put("role", "assistant")
              .put("content", "合成图片回复")
              .put("mode", "live"));
      nativeCall(
          scenario,
          "saveHistory",
          new JSONObject().put("history", new JSONObject().put("lin", rolled)));
      assertTrue(new JSONObject(settled(scenario)).getBoolean("ok"));
      assertFalse(syntheticReply.cancelled);
      // A newly selected draft resolves before the asynchronous history save effect.
      JSONObject wrongOwner = new JSONObject(request.toString()).put("characterId", "tao");
      assertThrows(
          IllegalArgumentException.class,
          () ->
              ConnectionService.prepareImageModelRequest(
                  wrongOwner,
                  persona,
                  "deepseek-flash",
                  true,
                  store::resolve,
                  new NativeHttp.Cancellation()));
      JSONObject turn =
          new JSONObject()
              .put("id", "synthetic-user-image")
              .put("role", "user")
              .put("content", "")
              .put("image", image);
      JSONObject history = new JSONObject().put("lin", new JSONArray().put(turn));
      nativeCall(scenario, "saveHistory", new JSONObject().put("history", history));
      assertTrue(new JSONObject(settled(scenario)).getBoolean("ok"));
      assertTrue("Explicit tail replacement cancels pending work", syntheticReply.cancelled);
      assertTrue(store.generation("lin") > beforeRollover);
      synchronized (connection) {
        active.remove("synthetic-rollover-reply");
      }
      nativeCall(scenario, "loadHistory", new JSONObject());
      JSONObject loaded = new JSONObject(settled(scenario));
      assertTrue(loaded.getBoolean("ok"));
      String persisted = loaded.getJSONObject("value").toString();
      assertTrue(persisted.contains(imageId));
      assertFalse(persisted.contains("data:image"));
      assertFalse(persisted.contains("previewUrl"));
      // Recreate the actual Activity: image-only history and references survive for retry.
      scenario.recreate();
      NativeOriginStorageSmokeTest.awaitAndroidSettings(scenario);
      QibanPlugin[] restartedHolder = new QibanPlugin[1];
      scenario.onActivity(
          activity ->
              restartedHolder[0] =
                  (QibanPlugin) activity.getBridge().getPlugin("Qiban").getInstance());
      QibanPlugin restartedPlugin = restartedHolder[0];
      ChatImageStore restartedStore = (ChatImageStore) field(restartedPlugin, "chatImages");
      assertNotNull(restartedStore.preview("lin", imageId));
      nativeCall(scenario, "loadHistory", new JSONObject());
      JSONObject reloaded = new JSONObject(settled(scenario));
      JSONObject imageOnly = reloaded.getJSONObject("value").getJSONArray("lin").getJSONObject(0);
      assertEquals("", imageOnly.getString("content"));
      assertEquals(imageId, imageOnly.getJSONObject("image").getString("id"));
      JSONObject retry =
          new JSONObject()
              .put("characterId", "lin")
              .put(
                  "messages",
                  new JSONArray()
                      .put(
                          new JSONObject()
                              .put("role", "user")
                              .put("content", "")
                              .put("image", imageOnly.getJSONObject("image"))));
      ConnectionService.PreparedImageRequest retried =
          ConnectionService.prepareImageModelRequest(
              retry,
              persona,
              "deepseek-flash",
              true,
              restartedStore::resolve,
              new NativeHttp.Cancellation());
      JSONArray retryParts =
          retried.body.getJSONArray("messages").getJSONObject(3).getJSONArray("content");
      assertEquals("", retryParts.getJSONObject(0).getString("text"));
      assertEquals(
          preview, retryParts.getJSONObject(1).getJSONObject("image_url").getString("url"));
      // Discard protects a committed reference; reset removes it and invalidates an old picker.
      nativeCall(
          scenario,
          "discardChatImage",
          new JSONObject().put("characterId", "lin").put("imageId", imageId));
      assertTrue(new JSONObject(settled(scenario)).getBoolean("ok"));
      assertNotNull(restartedStore.preview("lin", imageId));
      long oldGeneration = restartedStore.generation("lin");
      nativeCall(scenario, "saveHistory", new JSONObject().put("history", new JSONObject()));
      assertTrue(new JSONObject(settled(scenario)).getBoolean("ok"));
      assertNull(restartedStore.preview("lin", imageId));
      assertFalse(
          pickerResult(restartedPlugin, restartedStore, oldGeneration, Activity.RESULT_OK)
              .result
              .getBoolean("ok"));
      RecordingCall fresh =
          pickerResult(
              restartedPlugin,
              restartedStore,
              restartedStore.generation("lin"),
              Activity.RESULT_OK);
      String draftId = fresh.result.getJSONObject("value").getJSONObject("image").getString("id");
      nativeCall(
          scenario,
          "discardChatImage",
          new JSONObject().put("characterId", "lin").put("imageId", draftId));
      assertTrue(new JSONObject(settled(scenario)).getBoolean("ok"));
      assertNull(restartedStore.preview("lin", draftId));
      RecordingCall edited =
          pickerResult(
              restartedPlugin,
              restartedStore,
              restartedStore.generation("lin"),
              Activity.RESULT_OK);
      JSONObject editedImage = edited.result.getJSONObject("value").getJSONObject("image");
      JSONObject editedTurn =
          new JSONObject()
              .put("id", "synthetic-edited-image")
              .put("role", "user")
              .put("content", "保留文字")
              .put("image", editedImage);
      JSONObject editedHistory = new JSONObject().put("lin", new JSONArray().put(editedTurn));
      nativeCall(scenario, "saveHistory", new JSONObject().put("history", editedHistory));
      assertTrue(new JSONObject(settled(scenario)).getBoolean("ok"));
      ConnectionService restartedConnection =
          (ConnectionService) field(restartedPlugin, "connection");
      @SuppressWarnings("unchecked")
      java.util.Map<String, NativeHttp.Cancellation> editingActive =
          (java.util.Map<String, NativeHttp.Cancellation>) field(restartedConnection, "active");
      @SuppressWarnings("unchecked")
      java.util.Map<String, JSONObject> editingBasis =
          (java.util.Map<String, JSONObject>) field(restartedConnection, "activeBasis");
      NativeHttp.Cancellation editingReply = new NativeHttp.Cancellation();
      JSONObject textBasis =
          new JSONObject()
              .put("characterId", "lin")
              .put(
                  "messages",
                  new JSONArray()
                      .put(new JSONObject().put("role", "user").put("content", "替换后的文字")));
      synchronized (restartedConnection) {
        editingActive.put("synthetic-edited-reply", editingReply);
        editingBasis.put("synthetic-edited-reply", textBasis);
      }
      editedTurn.remove("image");
      editedTurn.put("content", "替换后的文字");
      nativeCall(scenario, "saveHistory", new JSONObject().put("history", editedHistory));
      assertTrue(new JSONObject(settled(scenario)).getBoolean("ok"));
      assertFalse(
          "Saving an edit already used by a new reply must not cancel it", editingReply.cancelled);
      assertNull(restartedStore.preview("lin", editedImage.getString("id")));
      assertThrows(
          IllegalArgumentException.class, () -> restartedStore.resolve("lin", editedImage));
      RecordingCall replacement =
          pickerResult(
              restartedPlugin,
              restartedStore,
              restartedStore.generation("lin"),
              Activity.RESULT_OK);
      JSONObject replacementImage =
          replacement.result.getJSONObject("value").getJSONObject("image");
      JSONObject imageBasis =
          new JSONObject()
              .put("characterId", "lin")
              .put(
                  "messages",
                  new JSONArray()
                      .put(
                          new JSONObject()
                              .put("role", "user")
                              .put("content", "")
                              .put("image", replacementImage)));
      synchronized (restartedConnection) {
        editingBasis.put("synthetic-edited-reply", imageBasis);
      }
      editedTurn.put("content", "").put("image", replacementImage);
      nativeCall(scenario, "saveHistory", new JSONObject().put("history", editedHistory));
      assertTrue(new JSONObject(settled(scenario)).getBoolean("ok"));
      assertFalse("Staged replacement image matches the new reply basis", editingReply.cancelled);
      assertNotNull(restartedStore.preview("lin", replacementImage.getString("id")));
      nativeCall(scenario, "saveHistory", new JSONObject().put("history", new JSONObject()));
      assertTrue(new JSONObject(settled(scenario)).getBoolean("ok"));
      assertTrue("Explicit reset still cancels a matching new request", editingReply.cancelled);
      assertNull(restartedStore.preview("lin", replacementImage.getString("id")));
      synchronized (restartedConnection) {
        editingActive.remove("synthetic-edited-reply");
        editingBasis.remove("synthetic-edited-reply");
      }
    }
  }

  private static void awaitRecoveredHistoryUI(ActivityScenario<MainActivity> scenario)
      throws Exception {
    NativeOriginStorageSmokeTest.awaitAndroidSettings(scenario);
    for (int attempt = 0; attempt < 100; attempt++) {
      if (evaluate(
              scenario,
              "String(!!document.querySelector('#message')&&!document.querySelector('#message').disabled&&document.body.textContent.includes('已有回复'))")
          .equals("true")) return;
      Thread.sleep(100);
    }
    fail(
        "Missing image must retain visible text and enable the actual composer after history"
            + " reload");
  }

  @Test
  public void missingImageAfterRestartKeepsBothConversationsEditable() throws Exception {
    // Seed durable state before mounting React. Out-of-band writes during startup can race
    // its initial save of the loaded conversation, which is not this recovery test's subject.
    android.content.Context context =
        androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().getTargetContext();
    ChatImageStore store = new ChatImageStore(context);
    android.graphics.Bitmap pixel =
        android.graphics.Bitmap.createBitmap(1, 1, android.graphics.Bitmap.Config.ARGB_8888);
    pixel.eraseColor(android.graphics.Color.BLUE);
    java.io.ByteArrayOutputStream source = new java.io.ByteArrayOutputStream();
    assertTrue(pixel.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, source));
    pixel.recycle();
    JSONObject image = store.importImage("lin", source.toByteArray()).getJSONObject("image");
    JSONObject user =
        new JSONObject()
            .put("id", "missing-image-turn")
            .put("role", "user")
            .put("content", "保留文字")
            .put("image", image);
    JSONObject history =
        new JSONObject()
            .put(
                "lin",
                new JSONArray()
                    .put(user)
                    .put(
                        new JSONObject()
                            .put("id", "retained-reply")
                            .put("role", "assistant")
                            .put("content", "已有回复")))
            .put(
                "tao",
                new JSONArray()
                    .put(
                        new JSONObject()
                            .put("id", "unaffected-turn")
                            .put("role", "user")
                            .put("content", "另一个对话")));
    new DataStore(context).saveHistory(history);
    store.commitHistory(history);
    java.io.File root = (java.io.File) field(store, "root");
    assertTrue(
        "Recovery fixture must remove an existing committed image",
        new java.io.File(new java.io.File(root, "lin"), image.getString("id") + ".jpg").delete());
    assertNull(store.preview("lin", image.getString("id")));
    try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
      awaitRecoveredHistoryUI(scenario);
      scenario.recreate();
      awaitRecoveredHistoryUI(scenario);
      nativeCall(scenario, "loadHistory", new JSONObject());
      JSONObject loaded = new JSONObject(settled(scenario));
      assertTrue("Missing bytes must not reject all history", loaded.getBoolean("ok"));
      JSONObject restored = loaded.getJSONObject("value");
      assertEquals(history.toString(), restored.toString());
      nativeCall(
          scenario,
          "chatImagePreview",
          new JSONObject().put("characterId", "lin").put("imageId", image.getString("id")));
      JSONObject preview = new JSONObject(settled(scenario));
      assertTrue(preview.getBoolean("ok"));
      assertTrue(preview.isNull("value"));
      restored.getJSONArray("tao").getJSONObject(0).put("content", "仍可编辑另一对话");
      nativeCall(scenario, "saveHistory", new JSONObject().put("history", restored));
      assertTrue(
          "Unchanged missing reference permits unrelated edits",
          new JSONObject(settled(scenario)).getBoolean("ok"));
      restored.getJSONArray("lin").getJSONObject(0).remove("image");
      restored.getJSONArray("lin").getJSONObject(0).put("content", "图片已移除，文字保留");
      nativeCall(scenario, "saveHistory", new JSONObject().put("history", restored));
      assertTrue(
          "Text recovery remains available", new JSONObject(settled(scenario)).getBoolean("ok"));
      nativeCall(scenario, "loadHistory", new JSONObject());
      JSONObject recovered = new JSONObject(settled(scenario));
      assertTrue(recovered.getBoolean("ok"));
      assertEquals(
          "图片已移除，文字保留",
          recovered
              .getJSONObject("value")
              .getJSONArray("lin")
              .getJSONObject(0)
              .getString("content"));
      nativeCall(scenario, "saveHistory", new JSONObject().put("history", new JSONObject()));
      assertTrue(new JSONObject(settled(scenario)).getBoolean("ok"));
    }
  }
}
