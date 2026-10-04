package app.qiban.mobile;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Matrix;
import android.graphics.Paint;
import android.graphics.Rect;
import android.media.ExifInterface;
import android.util.Base64;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.function.BooleanSupplier;
import java.util.regex.Pattern;
import java.util.zip.CRC32;
import org.json.JSONArray;
import org.json.JSONObject;

/** Conversation-owned immutable images; the bridge accepts references, never paths or URLs. */
public final class ChatImageStore {
  static final int SOURCE_BYTES = 5 * 1024 * 1024,
      IMAGE_BYTES = 1024 * 1024,
      TOTAL_BYTES = 64 * 1024 * 1024,
      MAX_FILES = 512;
  private static final Pattern IMAGE =
      Pattern.compile("image-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}");
  private static final Pattern CARD =
      Pattern.compile("card-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}");
  private final File root;
  private final Map<String, Set<String>> drafts = new HashMap<>(), committed = new HashMap<>();
  private final Map<String, Long> generations = new HashMap<>();
  private long clock = 0;

  public ChatImageStore(Context context) {
    this(new File(context.getFilesDir(), "qiban-chat-images"));
  }

  ChatImageStore(File root) {
    this.root = root;
    if (!root.isDirectory() && !root.mkdirs()) throw error("无法创建聊天图片目录");
  }

  public static final class StoredImage {
    public final JSONObject attachment;
    public final byte[] bytes;

    StoredImage(JSONObject attachment, byte[] bytes) {
      this.attachment = attachment;
      this.bytes = bytes;
    }
  }

  private static IllegalArgumentException error(String text) {
    return new IllegalArgumentException(text);
  }

  private static boolean validOwner(String owner) {
    return owner != null
        && (Arrays.asList("lin", "tao", "dou", "moon").contains(owner)
            || CARD.matcher(owner).matches());
  }

  private static void checkOwner(String owner) {
    if (!validOwner(owner)) throw error("聊天图片所属角色无效");
  }

  private static void checkImage(String id) {
    if (id == null || !IMAGE.matcher(id).matches()) throw error("聊天图片标识无效");
  }

  private File ownerDirectory(String owner, boolean create) throws IOException {
    checkOwner(owner);
    File directory = new File(root, owner);
    if (!directory.getCanonicalFile().equals(directory.getAbsoluteFile())) throw new IOException();
    if (create && !directory.isDirectory() && !directory.mkdir()) throw new IOException();
    return directory;
  }

  private File imageFile(String owner, String id, boolean create) throws IOException {
    checkImage(id);
    return new File(ownerDirectory(owner, create), id + ".jpg");
  }

  public synchronized long generation(String owner) {
    checkOwner(owner);
    if (!generations.containsKey(owner)) generations.put(owner, clock);
    return generations.get(owner);
  }

  /** Oldest-turn pruning preserves the previous tail; only removing or editing it resets work. */
  public static boolean tailRemovedOrChanged(JSONArray previous, JSONArray next) {
    if (previous == null || previous.length() == 0) return false;
    JSONObject tail = previous.optJSONObject(previous.length() - 1);
    if (tail == null || !(tail.opt("id") instanceof String) || next == null) return true;
    for (int i = 0; i < next.length(); i++) {
      JSONObject candidate = next.optJSONObject(i);
      if (candidate != null
          && tail.opt("id").equals(candidate.opt("id"))
          && sameTurn(tail, candidate)) return false;
    }
    return true;
  }

  private static boolean sameTurn(JSONObject left, JSONObject right) {
    for (String key : Arrays.asList("id", "role", "content", "mode", "image")) {
      if (left.has(key) != right.has(key)) return false;
      if (!left.has(key)) continue;
      if (key.equals("image")) {
        JSONObject a = left.optJSONObject(key), b = right.optJSONObject(key);
        if (a == null || b == null) return false;
        for (String field : Arrays.asList("id", "mimeType", "byteLength", "width", "height")) {
          if (a.has(field) != b.has(field)) return false;
          Object av = a.opt(field), bv = b.opt(field);
          if (av instanceof Number && bv instanceof Number) {
            if (Double.compare(((Number) av).doubleValue(), ((Number) bv).doubleValue()) != 0)
              return false;
          } else if (!Objects.equals(av, bv)) return false;
        }
      } else if (!Objects.equals(left.opt(key), right.opt(key))) return false;
    }
    return true;
  }

  /** Invalidates outstanding picker callbacks without taking ownership of draft deletion. */
  public synchronized void invalidatePending(String owner) {
    checkOwner(owner);
    generations.put(owner, ++clock);
  }

  static void validateAttachment(JSONObject image) {
    if (image == null || image.length() != 5) throw error("聊天图片引用格式无效");
    Iterator<String> keys = image.keys();
    while (keys.hasNext())
      if (!Arrays.asList("id", "mimeType", "byteLength", "width", "height").contains(keys.next()))
        throw error("聊天图片引用格式无效");
    if (!(image.opt("id") instanceof String)) throw error("聊天图片引用格式无效");
    checkImage(image.optString("id"));
    if (!Arrays.asList("image/jpeg", "image/png", "image/webp").contains(image.opt("mimeType")))
      throw error("聊天图片引用格式无效");
    for (String key : Arrays.asList("byteLength", "width", "height")) {
      Object value = image.opt(key);
      if (!(value instanceof Number)) throw error("聊天图片引用格式无效");
      double n = ((Number) value).doubleValue();
      if (!Double.isFinite(n)
          || n != Math.floor(n)
          || n <= 0
          || n > (key.equals("byteLength") ? IMAGE_BYTES : 1600)) throw error("聊天图片引用格式无效");
    }
  }

  private static long big(byte[] b, int p) {
    return ((long) (b[p] & 255) << 24)
        | ((long) (b[p + 1] & 255) << 16)
        | ((long) (b[p + 2] & 255) << 8)
        | (b[p + 3] & 255);
  }

  private static long little(byte[] b, int p) {
    return ((long) (b[p + 3] & 255) << 24)
        | ((long) (b[p + 2] & 255) << 16)
        | ((long) (b[p + 1] & 255) << 8)
        | (b[p] & 255);
  }

  private static String ascii(byte[] b, int offset, int length) {
    return new String(b, offset, length, StandardCharsets.US_ASCII);
  }

  private static String raster(byte[] b) {
    if (b.length >= 8
        && b[0] == (byte) 137
        && b[1] == 'P'
        && b[2] == 'N'
        && b[3] == 'G'
        && b[4] == 13
        && b[5] == 10
        && b[6] == 26
        && b[7] == 10) {
      int p = 8;
      boolean end = false, data = false;
      while (p < b.length) {
        if (b.length - p < 12) throw error("聊天图片格式无效");
        long len = big(b, p);
        if (len > b.length - p - 12) throw error("聊天图片格式无效");
        int n = (int) len;
        String type = ascii(b, p + 4, 4);
        if (Arrays.asList("acTL", "fcTL", "fdAT").contains(type)) throw error("不支持动画图片");
        if (p == 8 && (!type.equals("IHDR") || n != 13)) throw error("聊天图片格式无效");
        if (p != 8 && type.equals("IHDR")) throw error("聊天图片格式无效");
        CRC32 crc = new CRC32();
        crc.update(b, p + 4, n + 4);
        if (crc.getValue() != big(b, p + n + 8)) throw error("聊天图片格式无效");
        p += n + 12;
        if (type.equals("IDAT")) data = true;
        if (type.equals("IEND")) {
          if (n != 0 || p != b.length || !data) throw error("聊天图片格式无效");
          end = true;
          break;
        }
      }
      if (!end) throw error("聊天图片格式无效");
      return "image/png";
    }
    if (b.length >= 12 && ascii(b, 0, 4).equals("RIFF") && ascii(b, 8, 4).equals("WEBP")) {
      if (little(b, 4) + 8 != b.length) throw error("聊天图片格式无效");
      int p = 12;
      while (p < b.length) {
        if (b.length - p < 8) throw error("聊天图片格式无效");
        String type = ascii(b, p, 4);
        long size = little(b, p + 4);
        if (size > b.length - p - 8) throw error("聊天图片格式无效");
        int n = (int) size;
        if (type.equals("ANIM")
            || type.equals("ANMF")
            || (type.equals("VP8X") && n > 0 && (b[p + 8] & 2) != 0)) throw error("不支持动画图片");
        p += 8 + n + (n & 1);
        if (p > b.length) throw error("聊天图片格式无效");
      }
      return "image/webp";
    }
    if (b.length >= 4
        && b[0] == (byte) 255
        && b[1] == (byte) 216
        && b[2] == (byte) 255
        && b[b.length - 2] == (byte) 255
        && b[b.length - 1] == (byte) 217) return "image/jpeg";
    throw error("仅支持静态 PNG、JPEG 或 WebP 聊天图片");
  }

  private static BitmapFactory.Options dimensions(byte[] b, int edge) {
    String mime = raster(b);
    BitmapFactory.Options info = new BitmapFactory.Options();
    info.inJustDecodeBounds = true;
    BitmapFactory.decodeByteArray(b, 0, b.length, info);
    if (info.outWidth <= 0
        || info.outHeight <= 0
        || info.outWidth > edge
        || info.outHeight > edge
        || !mime.equals(info.outMimeType)) throw error("聊天图片尺寸或格式无效");
    return info;
  }

  private static byte[] normalize(byte[] source) {
    if (source == null || source.length == 0 || source.length > SOURCE_BYTES)
      throw error("聊天图片超过 5 MiB 限制");
    BitmapFactory.Options size = dimensions(source, 4096), decode = new BitmapFactory.Options();
    int sample = 1;
    while (size.outWidth / sample > 3200 || size.outHeight / sample > 3200) sample *= 2;
    decode.inSampleSize = sample;
    decode.inPreferredConfig = Bitmap.Config.ARGB_8888;
    Bitmap original = BitmapFactory.decodeByteArray(source, 0, source.length, decode);
    if (original == null) throw error("无法读取聊天图片");
    if ("image/jpeg".equals(size.outMimeType)) {
      try {
        int orientation =
            new ExifInterface(new ByteArrayInputStream(source))
                .getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL);
        Matrix matrix = new Matrix();
        switch (orientation) {
          case 2:
            matrix.setScale(-1, 1);
            break;
          case 3:
            matrix.setRotate(180);
            break;
          case 4:
            matrix.setScale(1, -1);
            break;
          case 5:
            matrix.setRotate(90);
            matrix.postScale(-1, 1);
            break;
          case 6:
            matrix.setRotate(90);
            break;
          case 7:
            matrix.setRotate(-90);
            matrix.postScale(-1, 1);
            break;
          case 8:
            matrix.setRotate(-90);
            break;
        }
        if (!matrix.isIdentity()) {
          Bitmap oriented =
              Bitmap.createBitmap(
                  original, 0, 0, original.getWidth(), original.getHeight(), matrix, true);
          if (oriented != original) {
            original.recycle();
            original = oriented;
          }
        }
      } catch (IOException ignored) {
        /* Missing EXIF does not change decoded pixels. */
      }
    }
    try {
      double scale = Math.min(1.0, 1600.0 / Math.max(original.getWidth(), original.getHeight()));
      int width = Math.max(1, (int) Math.round(original.getWidth() * scale)),
          height = Math.max(1, (int) Math.round(original.getHeight() * scale));
      for (int resize = 0; resize < 5; resize++) {
        Bitmap canvas = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
        try {
          canvas.eraseColor(Color.WHITE);
          new Canvas(canvas)
              .drawBitmap(
                  original,
                  null,
                  new Rect(0, 0, width, height),
                  new Paint(Paint.FILTER_BITMAP_FLAG));
          for (int quality : new int[] {90, 80, 70, 60}) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            if (!canvas.compress(Bitmap.CompressFormat.JPEG, quality, out)) throw error("无法转换聊天图片");
            if (out.size() <= IMAGE_BYTES) return out.toByteArray();
          }
        } finally {
          canvas.recycle();
        }
        width = Math.max(1, width * 4 / 5);
        height = Math.max(1, height * 4 / 5);
      }
      throw error("转换后的聊天图片超过容量限制");
    } finally {
      original.recycle();
    }
  }

  private static JSONObject attachment(String id, byte[] bytes) throws Exception {
    BitmapFactory.Options info = dimensions(bytes, 1600);
    if (!"image/jpeg".equals(info.outMimeType)) throw error("聊天图片文件损坏");
    return new JSONObject()
        .put("id", id)
        .put("mimeType", info.outMimeType)
        .put("byteLength", bytes.length)
        .put("width", info.outWidth)
        .put("height", info.outHeight);
  }

  private static String dataUrl(byte[] bytes) {
    return "data:image/jpeg;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP);
  }

  private static void checkCancelled(BooleanSupplier cancelled) {
    if (cancelled.getAsBoolean() || Thread.currentThread().isInterrupted())
      throw error("聊天图片读取已取消");
  }

  private byte[] read(File file) throws IOException {
    return read(file, () -> false);
  }

  private byte[] read(File file, BooleanSupplier cancelled) throws IOException {
    checkCancelled(cancelled);
    if (!file.isFile()
        || !file.getCanonicalFile().equals(file.getAbsoluteFile())
        || file.length() > IMAGE_BYTES) throw new IOException();
    try (InputStream in = new FileInputStream(file);
        ByteArrayOutputStream out = new ByteArrayOutputStream()) {
      byte[] b = new byte[8192];
      int n;
      while ((n = in.read(b)) != -1) {
        checkCancelled(cancelled);
        if (out.size() + n > IMAGE_BYTES) throw new IOException();
        out.write(b, 0, n);
      }
      byte[] result = out.toByteArray();
      checkCancelled(cancelled);
      dimensions(result, 1600);
      Bitmap bitmap = BitmapFactory.decodeByteArray(result, 0, result.length);
      if (bitmap == null) throw new IOException();
      bitmap.recycle();
      checkCancelled(cancelled);
      return result;
    }
  }

  private static boolean ownedImage(String name) {
    return name.endsWith(".jpg") && IMAGE.matcher(name.substring(0, name.length() - 4)).matches();
  }

  private List<File> files() throws IOException {
    List<File> result = new ArrayList<>();
    File[] owners = root.listFiles();
    if (owners == null) throw new IOException();
    for (File directory : owners) {
      if (!validOwner(directory.getName())) continue;
      if (!directory.isDirectory()
          || !directory.getCanonicalFile().equals(directory.getAbsoluteFile()))
        throw new IOException();
      File[] children = directory.listFiles();
      if (children == null) throw new IOException();
      for (File file : children)
        if (ownedImage(file.getName()) || file.getName().matches("pending-[a-zA-Z0-9-]+\\.tmp"))
          result.add(file);
    }
    return result;
  }

  public synchronized JSONObject importImage(String owner, byte[] source) {
    checkOwner(owner);
    byte[] bytes = normalize(source);
    String id = "image-" + UUID.randomUUID();
    File temp = null;
    try {
      List<File> files = files();
      long total = bytes.length;
      for (File file : files) total += file.length();
      if (files.size() >= MAX_FILES || total > TOTAL_BYTES) throw error("本地聊天图片容量已满");
      File target = imageFile(owner, id, true);
      if (target.exists()) throw new IOException();
      temp = File.createTempFile("pending-", ".tmp", target.getParentFile());
      try (FileOutputStream out = new FileOutputStream(temp)) {
        out.write(bytes);
        out.getFD().sync();
      }
      if (!temp.renameTo(target)) throw new IOException();
      temp = null;
      drafts.computeIfAbsent(owner, key -> new HashSet<>()).add(id);
      return new JSONObject().put("image", attachment(id, bytes)).put("previewUrl", dataUrl(bytes));
    } catch (IllegalArgumentException e) {
      throw e;
    } catch (Exception e) {
      throw error("无法保存聊天图片");
    } finally {
      if (temp != null) temp.delete();
    }
  }

  public synchronized StoredImage resolve(String owner, JSONObject expected) {
    return resolve(owner, expected, () -> false);
  }

  public synchronized StoredImage resolve(
      String owner, JSONObject expected, BooleanSupplier cancelled) {
    checkOwner(owner);
    validateAttachment(expected);
    try {
      String id = expected.getString("id");
      byte[] bytes = read(imageFile(owner, id, false), cancelled);
      JSONObject actual = attachment(id, bytes);
      for (String key : Arrays.asList("id", "mimeType", "byteLength", "width", "height")) {
        if (key.equals("id") || key.equals("mimeType")) {
          if (!actual.get(key).equals(expected.get(key))) throw error("聊天图片引用与文件不一致");
        } else if (actual.getLong(key) != expected.getLong(key)) throw error("聊天图片引用与文件不一致");
      }
      checkCancelled(cancelled);
      return new StoredImage(actual, bytes);
    } catch (IllegalArgumentException e) {
      throw e;
    } catch (Exception e) {
      throw error("聊天图片缺失或损坏");
    }
  }

  public synchronized String preview(String owner, String id) {
    checkOwner(owner);
    checkImage(id);
    try {
      return dataUrl(read(imageFile(owner, id, false)));
    } catch (Exception e) {
      return null;
    }
  }

  public synchronized void discardDraft(String owner, String id) {
    checkOwner(owner);
    checkImage(id);
    Set<String> active = drafts.get(owner);
    if (active == null || !active.contains(id)) return;
    try {
      remove(imageFile(owner, id, false));
      active.remove(id);
    } catch (Exception e) {
      throw error("无法删除聊天图片草稿");
    }
  }

  public synchronized void validateReferences(JSONObject history) {
    DataStore.validateHistory(history);
    try {
      Iterator<String> owners = history.keys();
      while (owners.hasNext()) {
        String owner = owners.next();
        JSONArray messages = history.getJSONArray(owner);
        for (int i = 0; i < messages.length(); i++) {
          JSONObject message = messages.getJSONObject(i);
          if (message.has("image")) resolve(owner, message.getJSONObject("image"));
        }
      }
    } catch (IllegalArgumentException e) {
      throw e;
    } catch (Exception e) {
      throw error("聊天图片引用格式无效");
    }
  }

  public synchronized void commitHistory(JSONObject history) {
    validateReferences(history);
    Map<String, Set<String>> next = new HashMap<>();
    try {
      Iterator<String> owners = history.keys();
      while (owners.hasNext()) {
        String owner = owners.next();
        Set<String> ids = new HashSet<>();
        JSONArray messages = history.getJSONArray(owner);
        for (int i = 0; i < messages.length(); i++) {
          JSONObject message = messages.getJSONObject(i);
          if (message.has("image")) ids.add(message.getJSONObject("image").getString("id"));
        }
        next.put(owner, ids);
      }
      for (Map.Entry<String, Set<String>> entry : next.entrySet()) {
        Set<String> active = drafts.get(entry.getKey());
        if (active != null) active.removeAll(entry.getValue());
      }
      committed.clear();
      committed.putAll(next);
      for (File file : files()) {
        String owner = file.getParentFile().getName(), name = file.getName();
        if (ownedImage(name)) {
          String id = name.substring(0, name.length() - 4);
          if (next.getOrDefault(owner, Collections.emptySet()).contains(id)
              || drafts.getOrDefault(owner, Collections.emptySet()).contains(id)) continue;
        }
        remove(file);
      }
    } catch (IllegalArgumentException e) {
      throw e;
    } catch (Exception e) {
      throw error("聊天图片清理未完成");
    }
  }

  private static void remove(File file) throws IOException {
    if (!file.delete() && file.exists()) throw new IOException();
  }

  public synchronized void deleteConversation(String owner) {
    checkOwner(owner);
    generations.put(owner, ++clock);
    try {
      File directory = ownerDirectory(owner, false);
      File[] files = directory.listFiles();
      if (directory.exists() && files == null) throw new IOException();
      if (files != null)
        for (File file : files)
          if (ownedImage(file.getName()) || file.getName().matches("pending-[a-zA-Z0-9-]+\\.tmp"))
            remove(file);
      drafts.remove(owner);
      committed.remove(owner);
      if (directory.exists()) directory.delete();
    } catch (Exception e) {
      throw error("无法清除会话图片");
    }
  }

  public synchronized void deleteAll() {
    ++clock;
    for (String owner : new ArrayList<>(generations.keySet())) generations.put(owner, clock);
    try {
      for (File file : files()) remove(file);
      File[] directories = root.listFiles();
      if (directories != null)
        for (File directory : directories)
          if (validOwner(directory.getName()) && directory.isDirectory()) directory.delete();
      drafts.clear();
      committed.clear();
    } catch (Exception e) {
      throw error("无法清除聊天图片");
    }
  }
}
