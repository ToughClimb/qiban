package app.qiban.mobile;

import static org.junit.Assert.*;

import android.graphics.Bitmap;
import android.graphics.Color;
import android.media.ExifInterface;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.zip.CRC32;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.GraphicsMode;

@RunWith(RobolectricTestRunner.class)
@Config(manifest = Config.NONE, sdk = 35)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
public class ChatImageStoreTest {
  private static byte[] picture(int width, int height, Bitmap.CompressFormat format) {
    Bitmap bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
    bitmap.eraseColor(Color.BLUE);
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    assertTrue(bitmap.compress(format, 90, out));
    bitmap.recycle();
    return out.toByteArray();
  }

  private static JSONObject history(String owner, JSONObject image) throws Exception {
    return new JSONObject()
        .put(
            owner,
            new JSONArray()
                .put(
                    new JSONObject()
                        .put("id", "m1")
                        .put("role", "user")
                        .put("content", "")
                        .put("image", image)));
  }

  @Test
  public void normalizesAndChecksActualOwnershipAndMetadata() throws Exception {
    ChatImageStore store = new ChatImageStore(Files.createTempDirectory("qiban-images").toFile());
    JSONObject draft = store.importImage("lin", picture(2400, 1200, Bitmap.CompressFormat.PNG));
    JSONObject image = draft.getJSONObject("image");
    assertEquals(5, image.length());
    assertEquals(1600, image.getInt("width"));
    assertEquals(800, image.getInt("height"));
    assertEquals("image/jpeg", image.getString("mimeType"));
    assertTrue(draft.getString("previewUrl").startsWith("data:image/jpeg;base64,"));
    ChatImageStore.StoredImage resolved = store.resolve("lin", image);
    assertEquals(image.getInt("byteLength"), resolved.bytes.length);
    assertTrue(resolved.bytes.length <= ChatImageStore.IMAGE_BYTES);
    try {
      store.resolve("tao", image);
      fail();
    } catch (IllegalArgumentException expected) {
    }
    JSONObject forged = new JSONObject(image.toString()).put("width", 100);
    try {
      store.resolve("lin", forged);
      fail();
    } catch (IllegalArgumentException expected) {
    }
    assertNull(store.preview("tao", image.getString("id")));
  }

  @Test
  public void preservesDraftsThenReconcilesCommittedAndRestartOrphans() throws Exception {
    File directory = Files.createTempDirectory("qiban-images-history").toFile();
    ChatImageStore store = new ChatImageStore(directory);
    JSONObject first =
        store.importImage("lin", picture(10, 10, Bitmap.CompressFormat.PNG)).getJSONObject("image");
    JSONObject second =
        store.importImage("lin", picture(10, 10, Bitmap.CompressFormat.PNG)).getJSONObject("image");
    store.commitHistory(history("lin", first));
    assertNotNull(store.preview("lin", second.getString("id")));
    store.discardDraft("lin", first.getString("id"));
    assertNotNull(store.preview("lin", first.getString("id")));
    store.discardDraft("lin", second.getString("id"));
    assertNull(store.preview("lin", second.getString("id")));
    JSONObject orphan =
        store.importImage("tao", picture(10, 10, Bitmap.CompressFormat.PNG)).getJSONObject("image");
    ChatImageStore restart = new ChatImageStore(directory);
    restart.commitHistory(history("lin", first));
    assertNull(restart.preview("tao", orphan.getString("id")));
    assertNotNull(restart.preview("lin", first.getString("id")));
    restart.commitHistory(new JSONObject());
    assertNull(restart.preview("lin", first.getString("id")));
  }

  @Test
  public void corruptHistoryOrReferenceNeverTriggersPruning() throws Exception {
    File directory = Files.createTempDirectory("qiban-images-corrupt").toFile();
    ChatImageStore store = new ChatImageStore(directory);
    JSONObject image =
        store.importImage("lin", picture(10, 10, Bitmap.CompressFormat.PNG)).getJSONObject("image");
    ChatImageStore restart = new ChatImageStore(directory);
    try {
      restart.commitHistory(new JSONObject().put("lin", "invalid"));
      fail();
    } catch (IllegalArgumentException expected) {
    }
    assertNotNull(restart.preview("lin", image.getString("id")));
    JSONObject wrong = new JSONObject(image.toString()).put("byteLength", 1);
    try {
      restart.commitHistory(history("lin", wrong));
      fail();
    } catch (IllegalArgumentException expected) {
    }
    assertNotNull(restart.preview("lin", image.getString("id")));
    Files.write(
        new File(directory, "lin/" + image.getString("id") + ".jpg").toPath(),
        "broken".getBytes(StandardCharsets.UTF_8));
    try {
      restart.validateReferences(history("lin", image));
      fail();
    } catch (IllegalArgumentException expected) {
    }
    assertNull(restart.preview("lin", image.getString("id")));
  }

  private static byte[] animatedPng(byte[] png) throws Exception {
    ByteArrayOutputStream chunk = new ByteArrayOutputStream();
    byte[] type = "acTL".getBytes(StandardCharsets.US_ASCII);
    byte[] value = {0, 0, 0, 1, 0, 0, 0, 0};
    chunk.write(new byte[] {0, 0, 0, 8});
    chunk.write(type);
    chunk.write(value);
    CRC32 crc = new CRC32();
    crc.update(type);
    crc.update(value);
    long n = crc.getValue();
    chunk.write(new byte[] {(byte) (n >> 24), (byte) (n >> 16), (byte) (n >> 8), (byte) n});
    ByteArrayOutputStream result = new ByteArrayOutputStream();
    result.write(png, 0, 33);
    result.write(chunk.toByteArray());
    result.write(png, 33, png.length - 33);
    return result.toByteArray();
  }

  @Test
  public void rejectsAnimationUnsafeFormatsAndBoundsBeforeDecode() throws Exception {
    ChatImageStore store =
        new ChatImageStore(Files.createTempDirectory("qiban-images-invalid").toFile());
    byte[] webp = {
      'R', 'I', 'F', 'F', 14, 0, 0, 0, 'W', 'E', 'B', 'P', 'A', 'N', 'I', 'M', 2, 0, 0, 0, 0, 0
    };
    for (byte[] invalid :
        new byte[][] {
          "<svg/>".getBytes(StandardCharsets.UTF_8),
          "GIF89a".getBytes(StandardCharsets.UTF_8),
          animatedPng(picture(10, 10, Bitmap.CompressFormat.PNG)),
          webp,
          new byte[ChatImageStore.SOURCE_BYTES + 1],
          picture(4097, 1, Bitmap.CompressFormat.PNG)
        }) {
      try {
        store.importImage("lin", invalid);
        fail();
      } catch (IllegalArgumentException expected) {
      }
    }
    try {
      store.importImage("../outside", picture(10, 10, Bitmap.CompressFormat.PNG));
      fail();
    } catch (IllegalArgumentException expected) {
    }
  }

  @Test
  public void generationsAndScopedDeletionInvalidatePickerResults() throws Exception {
    File directory = Files.createTempDirectory("qiban-images-delete").toFile();
    ChatImageStore store = new ChatImageStore(directory);
    long before = store.generation("lin"), tao = store.generation("tao");
    JSONObject
        lin =
            store
                .importImage("lin", picture(10, 10, Bitmap.CompressFormat.PNG))
                .getJSONObject("image"),
        other =
            store
                .importImage("tao", picture(10, 10, Bitmap.CompressFormat.PNG))
                .getJSONObject("image");
    File unrelated = new File(directory, "unrelated.txt");
    Files.write(unrelated.toPath(), new byte[] {1});
    store.deleteConversation("lin");
    assertTrue(store.generation("lin") > before);
    assertEquals(tao, store.generation("tao"));
    assertNull(store.preview("lin", lin.getString("id")));
    assertNotNull(store.preview("tao", other.getString("id")));
    long reset = store.generation("lin");
    store.deleteAll();
    assertTrue(store.generation("lin") > reset);
    assertTrue(store.generation("tao") > tao);
    assertTrue(unrelated.exists());
    assertNull(store.preview("tao", other.getString("id")));
  }

  @Test
  public void accountsForAllOwnedFilesBeforeAddingDrafts() throws Exception {
    File directory = Files.createTempDirectory("qiban-images-budget").toFile();
    ChatImageStore store = new ChatImageStore(directory);
    File owner = new File(directory, "lin");
    assertTrue(owner.mkdir());
    File huge = new File(owner, "image-" + UUID.randomUUID() + ".jpg");
    try (RandomAccessFile file = new RandomAccessFile(huge, "rw")) {
      file.setLength(ChatImageStore.TOTAL_BYTES);
    }
    byte[] source = picture(10, 10, Bitmap.CompressFormat.PNG);
    try {
      store.importImage("lin", source);
      fail("all owned bytes must count, even damaged files");
    } catch (IllegalArgumentException expected) {
    }
    assertEquals(ChatImageStore.TOTAL_BYTES, huge.length());
    store.deleteAll();
    assertTrue(owner.mkdir());
    for (int i = 0; i < ChatImageStore.MAX_FILES; i++)
      Files.write(new File(owner, "image-" + UUID.randomUUID() + ".jpg").toPath(), new byte[0]);
    try {
      store.importImage("lin", source);
      fail("file count must bound draft accumulation");
    } catch (IllegalArgumentException expected) {
    }
    assertEquals(ChatImageStore.MAX_FILES, owner.listFiles().length);
  }

  @Test
  public void appliesExifOrientationAndStripsSourceMetadata() throws Exception {
    File directory = Files.createTempDirectory("qiban-image-exif").toFile();
    File sourceFile = new File(directory, "source.jpg");
    Files.write(sourceFile.toPath(), picture(40, 20, Bitmap.CompressFormat.JPEG));
    ExifInterface exif = new ExifInterface(sourceFile.getAbsolutePath());
    exif.setAttribute(ExifInterface.TAG_ORIENTATION, "6");
    exif.setAttribute(ExifInterface.TAG_ARTIST, "synthetic-test-metadata");
    exif.saveAttributes();
    ChatImageStore store = new ChatImageStore(new File(directory, "stored"));
    JSONObject image =
        store.importImage("lin", Files.readAllBytes(sourceFile.toPath())).getJSONObject("image");
    assertEquals(20, image.getInt("width"));
    assertEquals(40, image.getInt("height"));
    byte[] normalized = store.resolve("lin", image).bytes;
    assertFalse(
        new String(normalized, StandardCharsets.ISO_8859_1).contains("synthetic-test-metadata"));
  }

  @Test
  public void cancellationIsObservedDuringBoundedReads() throws Exception {
    ChatImageStore store =
        new ChatImageStore(Files.createTempDirectory("qiban-image-cancel").toFile());
    JSONObject image =
        store.importImage("lin", picture(10, 10, Bitmap.CompressFormat.PNG)).getJSONObject("image");
    AtomicInteger checks = new AtomicInteger();
    try {
      store.resolve("lin", image, () -> checks.incrementAndGet() >= 2);
      fail();
    } catch (IllegalArgumentException expected) {
      assertEquals("聊天图片读取已取消", expected.getMessage());
    }
    assertTrue(checks.get() >= 2);
    assertNotNull(store.preview("lin", image.getString("id")));
  }

  @Test
  public void rollingHistoryRetainsTailAndNewImageThroughRestart() throws Exception {
    File directory = Files.createTempDirectory("qiban-image-rolling").toFile();
    ChatImageStore store = new ChatImageStore(directory);
    JSONArray previous = new JSONArray();
    for (int i = 0; i < 200; i++)
      previous.put(
          new JSONObject()
              .put("id", "turn-" + i)
              .put("role", i % 2 == 0 ? "user" : "assistant")
              .put("content", "text " + i));
    store.commitHistory(new JSONObject().put("lin", previous));
    JSONObject image =
        store.importImage("lin", picture(10, 10, Bitmap.CompressFormat.PNG)).getJSONObject("image");
    JSONArray pending = new JSONArray();
    for (int i = 2; i < previous.length(); i++) pending.put(previous.getJSONObject(i));
    pending.put(
        new JSONObject()
            .put("id", "new-image-turn")
            .put("role", "user")
            .put("content", "")
            .put("image", image));
    assertEquals(199, pending.length());
    assertFalse(ChatImageStore.tailRemovedOrChanged(previous, pending));
    assertNotNull(store.resolve("lin", image));
    store.commitHistory(new JSONObject().put("lin", pending));
    assertNotNull(store.resolve("lin", image));
    JSONArray replied =
        new JSONArray(pending.toString())
            .put(
                new JSONObject()
                    .put("id", "new-reply")
                    .put("role", "assistant")
                    .put("content", "reply")
                    .put("mode", "demo"));
    assertEquals(200, replied.length());
    assertFalse(ChatImageStore.tailRemovedOrChanged(pending, replied));
    store.commitHistory(new JSONObject().put("lin", replied));
    ChatImageStore restart = new ChatImageStore(directory);
    restart.commitHistory(new JSONObject().put("lin", replied));
    assertFalse(ChatImageStore.tailRemovedOrChanged(replied, new JSONArray(replied.toString())));
    assertNotNull(restart.resolve("lin", image));
    JSONArray removed = new JSONArray();
    for (int i = 0; i < replied.length() - 1; i++) removed.put(replied.getJSONObject(i));
    assertTrue(ChatImageStore.tailRemovedOrChanged(replied, removed));
    JSONObject draft =
        restart
            .importImage("lin", picture(10, 10, Bitmap.CompressFormat.PNG))
            .getJSONObject("image");
    long generation = restart.generation("lin");
    restart.invalidatePending("lin");
    assertTrue(restart.generation("lin") > generation);
    assertNotNull(restart.resolve("lin", image));
    assertNotNull(restart.resolve("lin", draft));
  }

  @Test
  public void tailComparisonUsesSemanticFieldsRatherThanJsonKeyOrder() throws Exception {
    JSONObject image =
        new JSONObject()
            .put("id", "image-01234567-89ab-cdef-0123-456789abcdef")
            .put("mimeType", "image/jpeg")
            .put("byteLength", 30)
            .put("width", 100)
            .put("height", 50);
    JSONObject tail =
        new JSONObject()
            .put("id", "tail")
            .put("role", "user")
            .put("content", "")
            .put("image", image);
    JSONObject reordered =
        new JSONObject()
            .put("height", 50.0)
            .put("width", 100)
            .put("byteLength", 30)
            .put("mimeType", "image/jpeg")
            .put("id", image.getString("id"));
    JSONObject candidate =
        new JSONObject()
            .put("image", reordered)
            .put("content", "")
            .put("role", "user")
            .put("id", "tail");
    JSONArray previous = new JSONArray().put(tail);
    assertFalse(ChatImageStore.tailRemovedOrChanged(previous, new JSONArray().put(candidate)));
    assertFalse(ChatImageStore.tailRemovedOrChanged(new JSONArray(), new JSONArray()));
    for (String field : new String[] {"content", "role", "mode"}) {
      JSONObject changed = new JSONObject(candidate.toString()).put(field, "changed");
      assertTrue(ChatImageStore.tailRemovedOrChanged(previous, new JSONArray().put(changed)));
    }
    JSONObject changedImage = new JSONObject(reordered.toString()).put("width", 99);
    assertTrue(
        ChatImageStore.tailRemovedOrChanged(
            previous,
            new JSONArray().put(new JSONObject(candidate.toString()).put("image", changedImage))));
    assertTrue(ChatImageStore.tailRemovedOrChanged(previous, new JSONArray()));
  }
}
