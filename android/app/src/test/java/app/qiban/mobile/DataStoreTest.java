package app.qiban.mobile;

import static org.junit.Assert.*;

import android.content.Context;
import android.content.ContextWrapper;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(manifest = Config.NONE, sdk = 28)
public class DataStoreTest {
  private static final String RAW = "{\n  \"name\": \"测试\", \"extensions\": {\"note\":\"保留原文\"}\n}";

  private DataStore store() throws Exception {
    return new DataStore(Files.createTempDirectory("qiban-test").toFile());
  }

  private static Context aliasedFilesDir() throws Exception {
    java.nio.file.Path base = Files.createTempDirectory("qiban-trusted-base-alias");
    java.nio.file.Path actual = Files.createDirectory(base.resolve("actual"));
    File alias = Files.createSymbolicLink(base.resolve("files-alias"), actual).toFile();
    return new ContextWrapper(RuntimeEnvironment.getApplication()) {
      @Override
      public File getFilesDir() {
        return alias;
      }
    };
  }

  @Test
  public void retainsRawAndStableId() throws Exception {
    DataStore store = store();
    String id = store.saveCard(null, RAW);
    assertTrue(id.matches("card-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}"));
    assertEquals(RAW, store.rawCard(id));
    assertEquals(id, store.saveCard(id, RAW));
    assertEquals(1, store.listCards().getJSONArray("cards").length());
  }

  @Test
  public void rejectsUnsafeNestedFieldsAndLenientJson() throws Exception {
    for (String raw :
        new String[] {
          "{\"name\":\"a\",\"extensions\":{\"api_key\":\"synthetic\"}}",
          "{name:'a'}",
          "{\"name\":\"a\",}",
          "{\"name\":\"a\",\"name\":\"b\"}",
          "{\"name\":5}",
          "{\"name\":\"a\",\"spec\":\"wrong\"}"
        }) {
      try {
        DataStore.validateCard(raw);
        fail("invalid card accepted");
      } catch (IllegalArgumentException expected) {
        assertFalse(expected.getMessage().contains("synthetic"));
      }
    }
  }

  @Test
  public void boundsCountAndDepth() throws Exception {
    DataStore store = store();
    for (int i = 0; i < 100; i++) store.saveCard(null, RAW);
    try {
      store.saveCard(null, RAW);
      fail();
    } catch (IllegalArgumentException expected) {
    }
    String deep = "0";
    for (int i = 0; i < 17; i++) deep = "[" + deep + "]";
    try {
      DataStore.validateCard("{\"name\":\"a\",\"extra\":" + deep + "}");
      fail();
    } catch (IllegalArgumentException expected) {
    }
    try {
      DataStore.validateCard("{\"name\":\"" + "a".repeat(257) + "\"}");
      fail();
    } catch (IllegalArgumentException expected) {
    }
  }

  @Test
  public void corruptionIsReportedAndNeverOverwritten() throws Exception {
    File directory = Files.createTempDirectory("qiban-corrupt").toFile();
    DataStore store = new DataStore(directory);
    String id = store.saveCard(null, RAW);
    File file = new File(directory, id + ".json");
    Files.write(file.toPath(), "broken".getBytes(StandardCharsets.UTF_8));
    assertEquals(0, store.listCards().getJSONArray("cards").length());
    assertEquals(1, store.listCards().getJSONArray("issues").length());
    try {
      store.saveCard(id, RAW);
      fail();
    } catch (IllegalArgumentException expected) {
    }
    assertEquals("broken", new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8));
  }

  @Test
  public void validatesHistoryAndDeletesOnlyOwnedData() throws Exception {
    File directory = Files.createTempDirectory("qiban-history").toFile();
    DataStore store = new DataStore(directory);
    String id = store.saveCard(null, RAW);
    JSONObject user = new JSONObject().put("id", "m1").put("role", "user").put("content", "你好");
    JSONObject history = new JSONObject().put(id, new JSONArray().put(user));
    store.saveHistory(history);
    assertTrue(store.loadHistory().has(id));
    JSONObject invalid =
        new JSONObject()
            .put("lin", new JSONArray().put(new JSONObject(user.toString()).put("mode", "demo")));
    try {
      store.saveHistory(invalid);
      fail();
    } catch (IllegalArgumentException expected) {
    }
    store.deleteCard(id);
    assertFalse(store.loadHistory().has(id));
    File unrelated = new File(directory, "unrelated.txt");
    Files.write(unrelated.toPath(), "keep".getBytes(StandardCharsets.UTF_8));
    store.deleteAll();
    assertTrue(unrelated.exists());
    try {
      store.rawCard("../../outside");
      fail();
    } catch (IllegalArgumentException expected) {
    }
  }

  @Test
  public void keepsOnlyOnePreviousVersion() throws Exception {
    File directory = Files.createTempDirectory("qiban-backup").toFile();
    DataStore store = new DataStore(directory);
    String id = store.saveCard(null, RAW);
    String second = "{\"name\":\"second\"}", third = "{\"name\":\"third\"}";
    store.saveCard(id, second);
    store.saveCard(id, third);
    assertEquals(
        second,
        new String(
            Files.readAllBytes(new File(directory, id + ".bak").toPath()), StandardCharsets.UTF_8));
    assertEquals(third, store.rawCard(id));
    assertEquals(2, directory.listFiles().length);
  }

  @Test
  public void aggregateIncludesPreviousVersions() throws Exception {
    File directory = Files.createTempDirectory("qiban-budget").toFile();
    DataStore store = new DataStore(directory);
    JSONArray extras = new JSONArray();
    for (int i = 0; i < 10; i++) extras.put("x".repeat(12000));
    String raw = new JSONObject().put("name", "budget").put("extras", extras).toString();
    String first = null;
    for (int i = 0; i < 69; i++) {
      String id = store.saveCard(null, raw);
      if (first == null) first = id;
    }
    try {
      store.saveCard(first, raw);
      fail("backup must count toward aggregate");
    } catch (IllegalArgumentException expected) {
    }
    assertEquals(raw, store.rawCard(first));
    assertFalse(new File(directory, first + ".bak").exists());
    long total = 0;
    for (File file : directory.listFiles()) total += file.length();
    assertTrue(total <= DataStore.TOTAL_BYTES);
  }

  @Test
  public void corruptHistoryCannotBeOverwritten() throws Exception {
    File directory = Files.createTempDirectory("qiban-history-corrupt").toFile();
    DataStore store = new DataStore(directory);
    File file = new File(directory, "history.json");
    Files.write(file.toPath(), "broken".getBytes(StandardCharsets.UTF_8));
    try {
      store.saveHistory(new JSONObject());
      fail();
    } catch (IllegalArgumentException expected) {
    }
    assertEquals("broken", new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8));
    store.deleteAll();
    assertEquals(0, store.loadHistory().length());
  }

  @Test
  public void acceptsOnlyExactUserImageMetadataIncludingImageOnlyTurns() throws Exception {
    JSONObject image =
        new JSONObject()
            .put("id", "image-01234567-89ab-cdef-0123-456789abcdef")
            .put("mimeType", "image/jpeg")
            .put("byteLength", 30)
            .put("width", 100)
            .put("height", 100);
    JSONObject message =
        new JSONObject()
            .put("id", "image-turn")
            .put("role", "user")
            .put("content", "")
            .put("image", image);
    JSONObject history = new JSONObject().put("lin", new JSONArray().put(message));
    DataStore store = store();
    store.saveHistory(history);
    assertEquals(history.toString(), store.loadHistory().toString());
    for (String key : new String[] {"previewUrl", "imageOmitted"}) {
      JSONObject badMessage = new JSONObject(message.toString()).put(key, true);
      try {
        DataStore.validateHistory(new JSONObject().put("lin", new JSONArray().put(badMessage)));
        fail();
      } catch (IllegalArgumentException expected) {
      }
    }
    JSONObject extra = new JSONObject(image.toString()).put("path", "outside");
    try {
      DataStore.validateHistory(
          new JSONObject()
              .put(
                  "lin",
                  new JSONArray().put(new JSONObject(message.toString()).put("image", extra))));
      fail();
    } catch (IllegalArgumentException expected) {
    }
    JSONObject assistant =
        new JSONObject()
            .put("id", "assistant")
            .put("role", "assistant")
            .put("content", "hello")
            .put("image", image);
    try {
      DataStore.validateHistory(
          new JSONObject().put("lin", new JSONArray().put(message).put(assistant)));
      fail();
    } catch (IllegalArgumentException expected) {
    }
  }

  @Test
  public void trustedContextFilesDirAliasCanSaveAndReloadExistingHistory() throws Exception {
    Context context = aliasedFilesDir();
    DataStore store = new DataStore(context);
    JSONObject history =
        new JSONObject()
            .put(
                "lin",
                new JSONArray()
                    .put(
                        new JSONObject()
                            .put("id", "synthetic-user")
                            .put("role", "user")
                            .put("content", "合成测试记录")));
    store.saveHistory(history);
    assertEquals(history.toString(), store.loadHistory().toString());
    store.saveHistory(history);
    assertEquals(history.toString(), new DataStore(context).loadHistory().toString());
    assertTrue(
        new File(context.getFilesDir().getCanonicalFile(), "qiban-data/history.json").isFile());
  }

  @Test
  public void trustedContextFilesDirAliasPreservesExactSourceCardJson() throws Exception {
    Context context = aliasedFilesDir();
    DataStore store = new DataStore(context);
    String id = store.saveCard(null, RAW);
    assertEquals(RAW, store.rawCard(id));
    assertEquals(RAW, store.listCards().getJSONArray("cards").getJSONObject(0).getString("raw"));
    assertEquals(id, store.saveCard(id, RAW));
    assertEquals(RAW, new DataStore(context).rawCard(id));
  }

  @Test
  public void trustedBaseAliasDoesNotNormalizeOwnedDirectoryOrFileAliases() throws Exception {
    Context context = aliasedFilesDir();
    File base = context.getFilesDir().getCanonicalFile();
    java.nio.file.Path outside = Files.createTempDirectory("qiban-outside-data");
    File owned = new File(base, "qiban-data");
    Files.createSymbolicLink(owned.toPath(), outside);
    assertThrows(IllegalArgumentException.class, () -> new DataStore(context));
    Files.delete(owned.toPath());
    assertThrows(
        IllegalArgumentException.class,
        () -> new DataStore(new File(context.getFilesDir(), "qiban-data")));
    DataStore store = new DataStore(context);
    String id = "card-01234567-89ab-cdef-0123-456789abcdef";
    java.nio.file.Path source = outside.resolve("source.json");
    Files.write(source, RAW.getBytes(StandardCharsets.UTF_8));
    Files.createSymbolicLink(new File(owned, id + ".json").toPath(), source);
    assertThrows(IllegalArgumentException.class, () -> store.rawCard(id));
    assertThrows(IllegalArgumentException.class, () -> store.saveCard(id, RAW));
    assertEquals(0, store.listCards().getJSONArray("cards").length());
    assertEquals(1, store.listCards().getJSONArray("issues").length());
    java.nio.file.Path history = outside.resolve("outside-history.json");
    Files.write(history, "{}".getBytes(StandardCharsets.UTF_8));
    Files.createSymbolicLink(new File(owned, "history.json").toPath(), history);
    assertThrows(IllegalArgumentException.class, store::loadHistory);
    assertThrows(IllegalArgumentException.class, () -> store.saveHistory(new JSONObject()));
    assertEquals(RAW, new String(Files.readAllBytes(source), StandardCharsets.UTF_8));
    assertEquals("{}", new String(Files.readAllBytes(history), StandardCharsets.UTF_8));
  }

  @Test
  public void replacingOwnedDirectoryWithLinkCannotWriteOrDeleteOutside() throws Exception {
    Context context = aliasedFilesDir();
    File base = context.getFilesDir().getCanonicalFile();
    DataStore store = new DataStore(context);
    java.nio.file.Path owned = new File(base, "qiban-data").toPath();
    Files.move(owned, new File(base, "original-data").toPath());
    java.nio.file.Path outside = Files.createTempDirectory("qiban-outside-data-swap");
    java.nio.file.Path preserved = outside.resolve("history.json");
    Files.write(preserved, "{}".getBytes(StandardCharsets.UTF_8));
    Files.createSymbolicLink(owned, outside);
    assertThrows(IllegalArgumentException.class, store::loadHistory);
    assertThrows(IllegalArgumentException.class, () -> store.saveHistory(new JSONObject()));
    assertThrows(IllegalArgumentException.class, () -> store.saveCard(null, RAW));
    assertThrows(IllegalArgumentException.class, store::deleteAll);
    assertEquals("{}", new String(Files.readAllBytes(preserved), StandardCharsets.UTF_8));
    assertEquals(1, outside.toFile().listFiles().length);
  }
}
