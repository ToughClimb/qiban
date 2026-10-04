package app.qiban.mobile;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Rect;
import android.util.Base64;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.regex.Pattern;
import java.util.zip.CRC32;
import org.json.JSONObject;

/** Stores only bounded, normalized static PNGs in the app's private directory. */
public final class AvatarStore {
  static final int SOURCE_BYTES = 5 * 1024 * 1024,
      PNG_BYTES = 1024 * 1024,
      TOTAL_BYTES = 8 * 1024 * 1024;
  private static final Pattern CARD_ID =
      Pattern.compile("card-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}");
  private final File directory;

  public AvatarStore(Context context) {
    this(contextDirectory(context));
  }

  AvatarStore(File directory) {
    this.directory = directory.getAbsoluteFile();
    try {
      // Only Context's trusted base is canonicalized. Owned aliases remain forbidden.
      if (!this.directory.getCanonicalFile().equals(this.directory)) throw new IOException();
      if (!this.directory.isDirectory() && !this.directory.mkdirs()) throw new IOException();
      requireDirectory();
    } catch (Exception failure) {
      throw error("无法创建头像目录");
    }
  }

  private static File contextDirectory(Context context) {
    try {
      return new File(context.getFilesDir().getCanonicalFile(), "qiban-avatars");
    } catch (IOException failure) {
      throw error("无法创建头像目录");
    }
  }

  private void requireDirectory() {
    try {
      if (!directory.isDirectory() || !directory.getCanonicalFile().equals(directory))
        throw new IOException();
    } catch (IOException failure) {
      throw error("无法读取头像");
    }
  }

  private static IllegalArgumentException error(String message) {
    return new IllegalArgumentException(message);
  }

  private static boolean validId(String id) {
    return id != null
        && (Arrays.asList("lin", "tao", "dou", "moon").contains(id)
            || CARD_ID.matcher(id).matches());
  }

  private File image(String id) {
    requireDirectory();
    if (!validId(id)) throw error("头像角色标识无效");
    return new File(directory, id + ".png");
  }

  private static boolean png(byte[] bytes) {
    return bytes.length >= 8
        && bytes[0] == (byte) 137
        && bytes[1] == 80
        && bytes[2] == 78
        && bytes[3] == 71
        && bytes[4] == 13
        && bytes[5] == 10
        && bytes[6] == 26
        && bytes[7] == 10;
  }

  private static String format(byte[] bytes) {
    if (png(bytes)) return "image/png";
    if (bytes.length >= 3
        && bytes[0] == (byte) 255
        && bytes[1] == (byte) 216
        && bytes[2] == (byte) 255) return "image/jpeg";
    if (bytes.length >= 12
        && bytes[0] == 'R'
        && bytes[1] == 'I'
        && bytes[2] == 'F'
        && bytes[3] == 'F'
        && bytes[8] == 'W'
        && bytes[9] == 'E'
        && bytes[10] == 'B'
        && bytes[11] == 'P') return "image/webp";
    throw error("仅支持 PNG、JPEG 或 WebP 图片");
  }

  private static BitmapFactory.Options bounds(byte[] bytes, boolean saved) {
    String format = format(bytes);
    if (saved && !format.equals("image/png")) throw error("头像文件损坏");
    BitmapFactory.Options options = new BitmapFactory.Options();
    options.inJustDecodeBounds = true;
    BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
    int limit = saved ? 512 : 4096;
    if (options.outWidth <= 0
        || options.outHeight <= 0
        || options.outWidth > limit
        || options.outHeight > limit
        || !format.equals(options.outMimeType)) throw error("图片尺寸或格式无效");
    return options;
  }

  private static byte[] normalize(byte[] source) {
    if (source == null || source.length == 0 || source.length > SOURCE_BYTES)
      throw error("图片超过 5 MiB 限制");
    BitmapFactory.Options dimensions = bounds(source, false), options = new BitmapFactory.Options();
    int sample = 1;
    while (dimensions.outWidth / sample > 1024 || dimensions.outHeight / sample > 1024) sample *= 2;
    options.inSampleSize = sample;
    options.inPreferredConfig = Bitmap.Config.ARGB_8888;
    Bitmap bitmap = BitmapFactory.decodeByteArray(source, 0, source.length, options);
    if (bitmap == null) throw error("无法读取图片");
    Bitmap normalized = null;
    try {
      double ratio = Math.min(1.0, 512.0 / Math.max(bitmap.getWidth(), bitmap.getHeight()));
      int width = Math.max(1, (int) Math.round(bitmap.getWidth() * ratio));
      int height = Math.max(1, (int) Math.round(bitmap.getHeight() * ratio));
      normalized = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
      new Canvas(normalized)
          .drawBitmap(
              bitmap, null, new Rect(0, 0, width, height), new Paint(Paint.FILTER_BITMAP_FLAG));
      ByteArrayOutputStream out = new ByteArrayOutputStream();
      if (!normalized.compress(Bitmap.CompressFormat.PNG, 100, out)) throw error("无法转换头像");
      byte[] result = out.toByteArray();
      if (result.length > PNG_BYTES) throw error("转换后的头像超过容量限制");
      validate(result);
      return result;
    } finally {
      if (normalized != null) normalized.recycle();
      bitmap.recycle();
    }
  }

  private static long unsignedInt(byte[] bytes, int offset) {
    return ((long) (bytes[offset] & 255) << 24)
        | ((long) (bytes[offset + 1] & 255) << 16)
        | ((long) (bytes[offset + 2] & 255) << 8)
        | (bytes[offset + 3] & 255);
  }

  private static void pngStructure(byte[] bytes) {
    if (!png(bytes)) throw error("头像文件损坏");
    int offset = 8;
    boolean data = false, ended = false;
    while (offset < bytes.length) {
      if (bytes.length - offset < 12) throw error("头像文件损坏");
      long length = unsignedInt(bytes, offset);
      if (length > bytes.length - offset - 12) throw error("头像文件损坏");
      int size = (int) length;
      String type = new String(bytes, offset + 4, 4, StandardCharsets.US_ASCII);
      if (!Arrays.asList("IHDR", "PLTE", "tRNS", "IDAT", "IEND", "sBIT", "sRGB", "gAMA", "cHRM")
          .contains(type)) throw error("头像文件损坏");
      if (offset == 8 && (!type.equals("IHDR") || size != 13)) throw error("头像文件损坏");
      if (offset != 8 && type.equals("IHDR")) throw error("头像文件损坏");
      CRC32 crc = new CRC32();
      crc.update(bytes, offset + 4, size + 4);
      if (crc.getValue() != unsignedInt(bytes, offset + 8 + size)) throw error("头像文件损坏");
      offset += size + 12;
      if (type.equals("IDAT")) data = true;
      if (type.equals("IEND")) {
        if (size != 0 || offset != bytes.length || !data) throw error("头像文件损坏");
        ended = true;
        break;
      }
    }
    if (!ended) throw error("头像文件损坏");
  }

  private static void validate(byte[] bytes) {
    if (bytes.length == 0 || bytes.length > PNG_BYTES) throw error("头像文件损坏");
    pngStructure(bytes);
    bounds(bytes, true);
    Bitmap bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
    if (bitmap == null) throw error("头像文件损坏");
    bitmap.recycle();
  }

  private byte[] read(File file) throws IOException {
    requireDirectory();
    if (!file.isFile()
        || !file.getCanonicalFile().equals(file.getAbsoluteFile())
        || file.length() > PNG_BYTES) throw new IOException();
    try (InputStream in = new FileInputStream(file);
        ByteArrayOutputStream out = new ByteArrayOutputStream()) {
      byte[] buffer = new byte[4096];
      int size;
      while ((size = in.read(buffer)) != -1) {
        if (out.size() + size > PNG_BYTES) throw new IOException();
        out.write(buffer, 0, size);
      }
      byte[] bytes = out.toByteArray();
      validate(bytes);
      return bytes;
    }
  }

  private void atomic(File target, byte[] bytes) throws IOException {
    requireDirectory();
    File temp = File.createTempFile("pending-", ".tmp", directory);
    try {
      try (FileOutputStream out = new FileOutputStream(temp)) {
        out.write(bytes);
        out.getFD().sync();
      }
      if (!temp.renameTo(target)) throw new IOException();
    } finally {
      if (temp.exists()) temp.delete();
    }
  }

  private static String dataUrl(byte[] bytes) {
    return "data:image/png;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP);
  }

  public synchronized String importImage(String id, byte[] source) {
    File target = image(id), backup = new File(directory, id + ".bak");
    byte[] normalized = normalize(source);
    try {
      File[] files = directory.listFiles();
      if (files == null) throw new IOException();
      int count = 0;
      long total = normalized.length;
      for (File file : files) {
        String name = file.getName();
        if (name.endsWith(".png") && validId(name.substring(0, name.length() - 4))) {
          count++;
          if (!file.equals(target)) total += file.length();
        } else if (name.endsWith(".bak")
            && validId(name.substring(0, name.length() - 4))
            && !file.equals(backup)) total += file.length();
      }
      byte[] previous = null;
      if (target.exists()) {
        previous = read(target);
        total += previous.length;
        if (backup.exists()) read(backup);
      } else if (backup.exists()) {
        read(backup);
        total += backup.length();
      }
      if ((!target.exists() && count >= 104) || total > TOTAL_BYTES) throw error("本地头像容量已满");
      if (previous != null) atomic(backup, previous);
      atomic(target, normalized);
      return dataUrl(normalized);
    } catch (IllegalArgumentException e) {
      throw e;
    } catch (Exception e) {
      throw error("无法保存头像；原有数据已保留");
    }
  }

  public synchronized JSONObject list() {
    requireDirectory();
    JSONObject result = new JSONObject();
    File[] files = directory.listFiles();
    if (files == null) throw error("无法读取头像");
    Arrays.sort(files, Comparator.comparing(File::getName));
    int count = 0;
    long total = 0;
    for (File file : files) {
      String name = file.getName();
      if (!name.endsWith(".png")) continue;
      String id = name.substring(0, name.length() - 4);
      if (!validId(id)) continue;
      try {
        byte[] bytes = read(file);
        if (++count > 104 || (total += bytes.length) > TOTAL_BYTES) continue;
        result.put(id, dataUrl(bytes));
      } catch (Exception ignored) {
        /* Damaged images are never returned or overwritten. */
      }
    }
    return result;
  }

  private static void remove(File file) throws IOException {
    if (file.exists() && !file.delete()) throw new IOException();
  }

  public synchronized void delete(String id) {
    File target = image(id);
    try {
      remove(target);
      remove(new File(directory, id + ".bak"));
    } catch (Exception e) {
      throw error("无法删除头像");
    }
  }

  public synchronized void deleteAll() {
    requireDirectory();
    File[] files = directory.listFiles();
    if (files == null) throw error("无法读取头像");
    for (File file : files) {
      String name = file.getName();
      boolean owned = name.matches("pending-[a-zA-Z0-9-]+\\.tmp");
      if (name.endsWith(".png") || name.endsWith(".bak"))
        owned |= validId(name.substring(0, name.length() - 4));
      if (owned)
        try {
          remove(file);
        } catch (Exception e) {
          throw error("无法清除头像");
        }
    }
  }
}
