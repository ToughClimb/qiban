package app.qiban.mobile;

import android.content.Context;
import android.util.JsonReader;
import android.util.JsonToken;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONObject;

/** Closed, app-private data API. Imported metadata is stored, never executed. */
public final class DataStore {
  static final int CARD_BYTES = 128 * 1024,
      TOTAL_BYTES = 8 * 1024 * 1024,
      HISTORY_BYTES = 4 * 1024 * 1024;
  private static final Pattern ID =
      Pattern.compile("card-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}");
  private static final Set<String> FORBIDDEN =
      new HashSet<>(
          Arrays.asList(
              "__proto__",
              "constructor",
              "prototype",
              "code",
              "script",
              "scripts",
              "javascript",
              "execute",
              "exec",
              "eval",
              "command",
              "commands",
              "shell",
              "hooks",
              "webhook",
              "webhooks",
              "tool",
              "tools",
              "toolcalls",
              "toolchoice",
              "function",
              "functions",
              "mcp",
              "provider",
              "providers",
              "providerconfig",
              "model",
              "endpoint",
              "baseurl",
              "api",
              "apikey",
              "apikeys",
              "token",
              "accesstoken",
              "refreshtoken",
              "password",
              "secret",
              "secrets",
              "credential",
              "credentials",
              "authorization",
              "headers",
              "env",
              "environment"));
  private final File directory;

  public DataStore(Context context) {
    this(new File(context.getFilesDir(), "qiban-data"));
  }

  DataStore(File directory) {
    this.directory = directory;
    if (!directory.isDirectory() && !directory.mkdirs()) throw error("无法创建本地数据目录");
  }

  private static IllegalArgumentException error(String message) {
    return new IllegalArgumentException(message);
  }

  private static void checkId(String id) {
    if (id == null || !ID.matcher(id).matches()) throw error("角色标识无效");
  }

  private File card(String id) {
    checkId(id);
    return new File(directory, id + ".json");
  }

  private static int bytes(String value) {
    return value.getBytes(StandardCharsets.UTF_8).length;
  }

  private String read(File file, int limit) throws IOException {
    if (!file.isFile()
        || !file.getCanonicalFile().equals(file.getAbsoluteFile())
        || file.length() > limit) throw new IOException();
    try (InputStream in = new FileInputStream(file);
        ByteArrayOutputStream out = new ByteArrayOutputStream()) {
      byte[] buffer = new byte[4096];
      int n;
      while ((n = in.read(buffer)) != -1) {
        if (out.size() + n > limit) throw new IOException();
        out.write(buffer, 0, n);
      }
      return StandardCharsets.UTF_8
          .newDecoder()
          .decode(java.nio.ByteBuffer.wrap(out.toByteArray()))
          .toString();
    }
  }

  private void atomic(File target, String raw) throws IOException {
    File temp = File.createTempFile("pending-", ".tmp", directory);
    try {
      try (FileOutputStream out = new FileOutputStream(temp)) {
        out.write(raw.getBytes(StandardCharsets.UTF_8));
        out.getFD().sync();
      }
      if (!temp.renameTo(target)) throw new IOException();
    } finally {
      if (temp.exists()) temp.delete();
    }
  }

  private static void remove(File file) throws IOException {
    if (!file.delete() && file.exists()) throw new IOException();
  }

  public synchronized JSONObject listCards() {
    JSONArray cards = new JSONArray(), issues = new JSONArray();
    File[] files = directory.listFiles();
    if (files == null) throw error("无法读取本地数据");
    Arrays.sort(files, Comparator.comparing(File::getName));
    int count = 0;
    long total = 0;
    for (File file : files) {
      String name = file.getName();
      if (!name.endsWith(".json") || !ID.matcher(name.substring(0, name.length() - 5)).matches())
        continue;
      try {
        String raw = read(file, CARD_BYTES);
        validateCard(raw);
        if (++count > 100 || (total += bytes(raw)) > TOTAL_BYTES) throw error("容量超限");
        cards.put(new JSONObject().put("id", name.substring(0, name.length() - 5)).put("raw", raw));
      } catch (Exception e) {
        issues.put("本地角色卡损坏或超过容量限制，已跳过");
      }
    }
    try {
      return new JSONObject().put("cards", cards).put("issues", issues);
    } catch (Exception e) {
      throw error("无法读取本地数据");
    }
  }

  public synchronized String saveCard(String id, String raw) {
    validateCard(raw);
    if (id == null) id = "card-" + UUID.randomUUID();
    File target = card(id);
    File backup = new File(directory, id + ".bak");
    try {
      File[] files = directory.listFiles();
      if (files == null) throw new IOException();
      int count = 0;
      long total = bytes(raw);
      for (File file : files) {
        String name = file.getName();
        if (name.endsWith(".json") && ID.matcher(name.substring(0, name.length() - 5)).matches()) {
          count++;
          if (!file.equals(target)) total += file.length();
        } else if (name.endsWith(".bak")
            && ID.matcher(name.substring(0, name.length() - 4)).matches()
            && !file.equals(backup)) total += file.length();
      }
      if (target.exists()) total += target.length();
      else if (backup.exists()) total += backup.length();
      if ((!target.exists() && count >= 100) || total > TOTAL_BYTES) throw error("本地角色卡容量已满");
      if (target.exists()) {
        String previous = read(target, CARD_BYTES);
        validateCard(previous);
        if (backup.exists()) validateCard(read(backup, CARD_BYTES));
        atomic(backup, previous);
      }
      atomic(target, raw);
      return id;
    } catch (IllegalArgumentException e) {
      throw e;
    } catch (Exception e) {
      throw error("无法保存角色卡；原有数据已保留");
    }
  }

  public synchronized String rawCard(String id) {
    try {
      String raw = read(card(id), CARD_BYTES);
      validateCard(raw);
      return raw;
    } catch (Exception e) {
      throw error("无法读取角色卡");
    }
  }

  public synchronized void deleteCard(String id) {
    File target = card(id);
    JSONObject history = loadHistory();
    history.remove(id);
    saveHistory(history);
    try {
      remove(target);
      remove(new File(directory, id + ".bak"));
    } catch (Exception e) {
      throw error("无法删除角色卡");
    }
  }

  public synchronized JSONObject loadHistory() {
    File file = new File(directory, "history.json");
    if (!file.exists()) return new JSONObject();
    try {
      String raw = read(file, HISTORY_BYTES);
      try (JsonReader reader = new JsonReader(new StringReader(raw))) {
        reader.setLenient(false);
        inspectHistory(reader, 0, new int[] {0});
        if (reader.peek() != JsonToken.END_DOCUMENT) throw error("聊天记录格式无效");
      }
      JSONObject result = new JSONObject(raw);
      validateHistory(result);
      return result;
    } catch (Exception e) {
      throw error("聊天记录损坏，请先备份或清除本地数据");
    }
  }

  public synchronized void saveHistory(JSONObject history) {
    validateHistory(history);
    File target = new File(directory, "history.json");
    if (target.exists()) loadHistory();
    try {
      atomic(target, history.toString());
    } catch (Exception e) {
      throw error("无法保存聊天记录");
    }
  }

  public synchronized void deleteAll() {
    File[] files = directory.listFiles();
    if (files == null) throw error("无法读取本地数据");
    for (File file : files) {
      String name = file.getName();
      boolean owned = name.equals("history.json") || name.matches("pending-[a-zA-Z0-9-]+\\.tmp");
      if (name.endsWith(".json") || name.endsWith(".bak"))
        owned |= ID.matcher(name.substring(0, name.lastIndexOf('.'))).matches();
      if (owned)
        try {
          remove(file);
        } catch (Exception e) {
          throw error("无法清除本地数据");
        }
    }
  }

  static void validateHistory(JSONObject history) {
    try {
      if (history == null || history.length() > 100) throw error("聊天记录超过容量限制");
      Iterator<String> keys = history.keys();
      while (keys.hasNext()) {
        String id = keys.next();
        if (!Arrays.asList("lin", "tao", "dou", "moon").contains(id)) checkId(id);
        Object value = history.get(id);
        if (!(value instanceof JSONArray)) throw error("聊天记录格式无效");
        JSONArray messages = (JSONArray) value;
        if (messages.length() > 200) throw error("聊天记录过长");
        for (int i = 0; i < messages.length(); i++) {
          Object item = messages.get(i);
          if (!(item instanceof JSONObject)) throw error("聊天记录格式无效");
          JSONObject message = (JSONObject) item;
          Iterator<String> fields = message.keys();
          while (fields.hasNext())
            if (!Arrays.asList("id", "role", "content", "mode", "image").contains(fields.next()))
              throw error("聊天记录字段无效");
          if (!(message.opt("id") instanceof String)
              || bytes(message.getString("id")) > 256
              || !((i % 2 == 0) ? "user" : "assistant").equals(message.opt("role"))
              || !(message.opt("content") instanceof String)) throw error("聊天记录格式无效");
          if (message.has("image")) {
            if (i % 2 != 0 || !(message.opt("image") instanceof JSONObject))
              throw error("聊天图片引用格式无效");
            ChatImageStore.validateAttachment(message.getJSONObject("image"));
          }
          String content = message.getString("content");
          if ((content.isEmpty() && !message.has("image")) || content.length() > 8000)
            throw error("聊天内容长度无效");
          if (message.has("mode")
              && (i % 2 == 0 || !Arrays.asList("demo", "live").contains(message.opt("mode"))))
            throw error("聊天模式无效");
        }
      }
      if (bytes(history.toString()) > HISTORY_BYTES) throw error("聊天记录超过容量限制");
    } catch (IllegalArgumentException e) {
      throw e;
    } catch (Exception e) {
      throw error("聊天记录格式无效");
    }
  }

  static void validateCard(String raw) {
    if (raw == null || raw.length() > CARD_BYTES || bytes(raw) > CARD_BYTES)
      throw error("角色卡超过大小限制");
    try {
      try (JsonReader reader = new JsonReader(new StringReader(raw))) {
        reader.setLenient(false);
        inspect(reader, 0, new int[] {0});
        if (reader.peek() != JsonToken.END_DOCUMENT) throw error("角色卡格式无效");
      }
      JSONObject root = new JSONObject(raw), data = root;
      if (root.has("spec") || root.has("spec_version") || root.has("data")) {
        if (!"chara_card_v2".equals(root.opt("spec"))
            || !"2.0".equals(root.opt("spec_version"))
            || !(root.opt("data") instanceof JSONObject)) throw error("角色卡版本不受支持");
        data = root.getJSONObject("data");
      }
      field(data, "name", 256, true);
      field(data, "description", 8192, false);
      field(data, "personality", 8192, false);
      field(data, "scenario", 8192, false);
      field(data, "first_mes", 4096, false);
      field(data, "mes_example", 8192, false);
      field(data, "creator", 256, false);
      field(data, "creator_notes", 4096, false);
      field(data, "character_version", 64, false);
      list(data, "alternate_greetings", 8, 4096);
      list(data, "tags", 32, 64);
    } catch (IllegalArgumentException e) {
      throw e;
    } catch (Exception e) {
      throw error("角色卡不是有效的安全 JSON 数据");
    }
  }

  private static void field(JSONObject data, String key, int limit, boolean required)
      throws Exception {
    if (!data.has(key)) {
      if (required) throw error("角色卡缺少名称");
      return;
    }
    Object value = data.get(key);
    if (!(value instanceof String)
        || bytes((String) value) > limit
        || (required && ((String) value).trim().isEmpty())) throw error("角色卡字段类型或长度无效");
  }

  private static void list(JSONObject data, String key, int count, int limit) throws Exception {
    if (!data.has(key)) return;
    Object value = data.get(key);
    if (!(value instanceof JSONArray)) throw error("角色卡列表无效");
    JSONArray list = (JSONArray) value;
    if (list.length() > count) throw error("角色卡列表过长");
    for (int i = 0; i < list.length(); i++)
      if (!(list.get(i) instanceof String) || bytes(list.getString(i)) > limit)
        throw error("角色卡列表内容无效");
  }

  private static boolean forbidden(String key) {
    String lower = key.toLowerCase(Locale.ROOT);
    if (FORBIDDEN.contains(lower) || FORBIDDEN.contains(lower.replaceAll("[^a-z0-9]", "")))
      return true;
    for (String part : lower.split("[\\\\/.:]"))
      if (FORBIDDEN.contains(part.replaceAll("[^a-z0-9]", ""))) return true;
    return false;
  }

  private static void inspectHistory(JsonReader reader, int depth, int[] nodes) throws IOException {
    if (depth > 4 || ++nodes[0] > 200101) throw error("聊天记录结构无效");
    switch (reader.peek()) {
      case BEGIN_OBJECT:
        reader.beginObject();
        Set<String> names = new HashSet<>();
        while (reader.hasNext()) {
          String key = reader.nextName();
          if (key.length() > 256 || !names.add(key)) throw error("聊天记录字段无效");
          inspectHistory(reader, depth + 1, nodes);
        }
        reader.endObject();
        break;
      case BEGIN_ARRAY:
        reader.beginArray();
        int count = 0;
        while (reader.hasNext()) {
          if (++count > 200) throw error("聊天记录过长");
          inspectHistory(reader, depth + 1, nodes);
        }
        reader.endArray();
        break;
      case STRING:
        if (reader.nextString().length() > 8000) throw error("聊天内容长度无效");
        break;
      case NUMBER:
        reader.nextString();
        break;
      default:
        throw error("聊天记录格式无效");
    }
  }

  private static void inspect(JsonReader reader, int depth, int[] nodes) throws IOException {
    if (depth > 16 || ++nodes[0] > 4096) throw error("角色卡结构超过限制");
    switch (reader.peek()) {
      case BEGIN_OBJECT:
        reader.beginObject();
        Set<String> names = new HashSet<>();
        while (reader.hasNext()) {
          String key = reader.nextName();
          if (bytes(key) > 128 || forbidden(key) || !names.add(key)) throw error("角色卡包含不安全或重复字段");
          inspect(reader, depth + 1, nodes);
        }
        reader.endObject();
        break;
      case BEGIN_ARRAY:
        reader.beginArray();
        int count = 0;
        while (reader.hasNext()) {
          if (++count > 128) throw error("角色卡列表过长");
          inspect(reader, depth + 1, nodes);
        }
        reader.endArray();
        break;
      case STRING:
        if (bytes(reader.nextString()) > 16384) throw error("角色卡文本过长");
        break;
      case NUMBER:
        reader.nextString();
        break;
      case BOOLEAN:
        reader.nextBoolean();
        break;
      case NULL:
        reader.nextNull();
        break;
      default:
        throw error("角色卡格式无效");
    }
  }
}
