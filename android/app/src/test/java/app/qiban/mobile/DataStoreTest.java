package app.qiban.mobile;

import static org.junit.Assert.*;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(manifest = Config.NONE, sdk = 28)
public class DataStoreTest {
  private static final String RAW = "{\n  \"name\": \"测试\", \"extensions\": {\"note\":\"保留原文\"}\n}";

  private DataStore store() throws Exception {
    return new DataStore(Files.createTempDirectory("qiban-test").toFile());
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
}
