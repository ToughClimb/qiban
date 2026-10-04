package app.qiban.mobile;

import static org.junit.Assert.*;

import android.content.Context;
import android.content.ContextWrapper;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.util.Base64;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Random;
import java.util.UUID;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.GraphicsMode;

@RunWith(RobolectricTestRunner.class)
@Config(manifest = Config.NONE, sdk = 35)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
public class AvatarStoreTest {
  private static byte[] picture(int width, int height, Bitmap.CompressFormat format, int color) {
    Bitmap bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
    bitmap.eraseColor(color);
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    assertTrue(bitmap.compress(format, 90, out));
    bitmap.recycle();
    return out.toByteArray();
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
  public void convertsJpegToBoundedStaticPngAndListsIt() throws Exception {
    File directory = Files.createTempDirectory("qiban-avatar").toFile();
    AvatarStore store = new AvatarStore(directory);
    String url =
        store.importImage("lin", picture(1200, 600, Bitmap.CompressFormat.JPEG, Color.RED));
    assertTrue(url.startsWith("data:image/png;base64,"));
    byte[] bytes = Base64.decode(url.substring(url.indexOf(',') + 1), Base64.DEFAULT);
    BitmapFactory.Options options = new BitmapFactory.Options();
    options.inJustDecodeBounds = true;
    BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
    assertEquals(512, options.outWidth);
    assertEquals(256, options.outHeight);
    assertEquals("image/png", options.outMimeType);
    assertEquals(url, store.list().getString("lin"));
    assertTrue(bytes.length <= AvatarStore.PNG_BYTES);
  }

  @Test
  public void rejectsInvalidIdsFormatsSizesAndDimensions() throws Exception {
    AvatarStore store = new AvatarStore(Files.createTempDirectory("qiban-avatar-invalid").toFile());
    byte[] valid = picture(10, 10, Bitmap.CompressFormat.PNG, Color.BLUE);
    for (String id : new String[] {"../../outside", "card-invalid", "unknown"}) {
      try {
        store.importImage(id, valid);
        fail();
      } catch (IllegalArgumentException expected) {
      }
    }
    for (byte[] invalid :
        new byte[][] {
          "<svg/>".getBytes(StandardCharsets.UTF_8),
          "GIF89a".getBytes(StandardCharsets.UTF_8),
          new byte[AvatarStore.SOURCE_BYTES + 1],
          picture(4097, 1, Bitmap.CompressFormat.PNG, Color.BLUE)
        }) {
      try {
        store.importImage("lin", invalid);
        fail();
      } catch (IllegalArgumentException expected) {
      }
    }
    assertEquals(0, store.list().length());
  }

  @Test
  public void keepsOneBackupAndDoesNotOverwriteCorruption() throws Exception {
    File directory = Files.createTempDirectory("qiban-avatar-backup").toFile();
    AvatarStore store = new AvatarStore(directory);
    store.importImage("tao", picture(10, 10, Bitmap.CompressFormat.PNG, Color.RED));
    store.importImage("tao", picture(10, 10, Bitmap.CompressFormat.PNG, Color.BLUE));
    byte[] second = Files.readAllBytes(new File(directory, "tao.png").toPath());
    store.importImage("tao", picture(10, 10, Bitmap.CompressFormat.PNG, Color.GREEN));
    assertArrayEquals(second, Files.readAllBytes(new File(directory, "tao.bak").toPath()));
    assertEquals(2, directory.listFiles().length);
    Files.write(new File(directory, "tao.png").toPath(), "broken".getBytes(StandardCharsets.UTF_8));
    assertEquals(0, store.list().length());
    try {
      store.importImage("tao", picture(10, 10, Bitmap.CompressFormat.PNG, Color.RED));
      fail();
    } catch (IllegalArgumentException expected) {
    }
    assertEquals(
        "broken",
        new String(
            Files.readAllBytes(new File(directory, "tao.png").toPath()), StandardCharsets.UTF_8));
  }

  @Test
  public void deletesOnlyOwnedImagesAndBackups() throws Exception {
    File directory = Files.createTempDirectory("qiban-avatar-delete").toFile();
    AvatarStore store = new AvatarStore(directory);
    store.importImage("dou", picture(10, 10, Bitmap.CompressFormat.PNG, Color.BLUE));
    store.importImage("dou", picture(10, 10, Bitmap.CompressFormat.PNG, Color.RED));
    store.delete("dou");
    assertEquals(0, directory.listFiles().length);
    File unrelated = new File(directory, "unrelated.png");
    Files.write(unrelated.toPath(), new byte[] {1});
    store.importImage("moon", picture(10, 10, Bitmap.CompressFormat.PNG, Color.BLUE));
    store.deleteAll();
    assertTrue(unrelated.exists());
    assertEquals(1, directory.listFiles().length);
  }

  @Test
  public void aggregateLimitIncludesPreviousImage() throws Exception {
    File directory = Files.createTempDirectory("qiban-avatar-budget").toFile();
    AvatarStore store = new AvatarStore(directory);
    Bitmap bitmap = Bitmap.createBitmap(384, 384, Bitmap.Config.ARGB_8888);
    int[] pixels = new int[384 * 384];
    Random random = new Random(71);
    for (int i = 0; i < pixels.length; i++) pixels[i] = 0xff000000 | random.nextInt(0x1000000);
    bitmap.setPixels(pixels, 0, 384, 0, 0, 384, 384);
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG, 100, out));
    bitmap.recycle();
    byte[] source = out.toByteArray();
    String first = "card-" + UUID.randomUUID();
    store.importImage(first, source);
    boolean full = false;
    for (int i = 1; i < 104; i++) {
      try {
        store.importImage("card-" + UUID.randomUUID(), source);
      } catch (IllegalArgumentException expected) {
        full = true;
        break;
      }
    }
    assertTrue("aggregate limit should precede the count limit", full);
    try {
      store.importImage(first, source);
      fail("previous image must count toward the aggregate");
    } catch (IllegalArgumentException expected) {
    }
    assertFalse(new File(directory, first + ".bak").exists());
    long total = 0;
    for (File file : directory.listFiles()) total += file.length();
    assertTrue(total <= AvatarStore.TOTAL_BYTES);
  }

  @Test
  public void trustedContextFilesDirAliasCanImportAndListExistingAvatars() throws Exception {
    Context context = aliasedFilesDir();
    AvatarStore store = new AvatarStore(context);
    String first = store.importImage("lin", picture(10, 10, Bitmap.CompressFormat.PNG, Color.BLUE));
    assertEquals(first, store.list().getString("lin"));
    String next = store.importImage("lin", picture(10, 10, Bitmap.CompressFormat.PNG, Color.RED));
    assertEquals(next, new AvatarStore(context).list().getString("lin"));
    assertTrue(
        new File(context.getFilesDir().getCanonicalFile(), "qiban-avatars/lin.png").isFile());
    assertTrue(
        new File(context.getFilesDir().getCanonicalFile(), "qiban-avatars/lin.bak").isFile());
  }

  @Test
  public void trustedBaseAliasDoesNotNormalizeOwnedAvatarDirectoryOrImageAliases()
      throws Exception {
    Context context = aliasedFilesDir();
    File base = context.getFilesDir().getCanonicalFile();
    java.nio.file.Path outside = Files.createTempDirectory("qiban-outside-avatar");
    File owned = new File(base, "qiban-avatars");
    Files.createSymbolicLink(owned.toPath(), outside);
    assertThrows(IllegalArgumentException.class, () -> new AvatarStore(context));
    Files.delete(owned.toPath());
    assertThrows(
        IllegalArgumentException.class,
        () -> new AvatarStore(new File(context.getFilesDir(), "qiban-avatars")));
    AvatarStore store = new AvatarStore(context);
    byte[] source = picture(10, 10, Bitmap.CompressFormat.PNG, Color.BLUE);
    java.nio.file.Path preserved = outside.resolve("source.png");
    Files.write(preserved, source);
    Files.createSymbolicLink(new File(owned, "lin.png").toPath(), preserved);
    assertEquals(0, store.list().length());
    assertThrows(IllegalArgumentException.class, () -> store.importImage("lin", source));
    assertArrayEquals(source, Files.readAllBytes(preserved));
    store.importImage("tao", source);
    Files.createSymbolicLink(new File(owned, "tao.bak").toPath(), preserved);
    assertThrows(IllegalArgumentException.class, () -> store.importImage("tao", source));
    assertArrayEquals(source, Files.readAllBytes(preserved));
  }

  @Test
  public void replacingOwnedAvatarDirectoryWithLinkCannotWriteOrDeleteOutside() throws Exception {
    Context context = aliasedFilesDir();
    File base = context.getFilesDir().getCanonicalFile();
    AvatarStore store = new AvatarStore(context);
    java.nio.file.Path owned = new File(base, "qiban-avatars").toPath();
    Files.move(owned, new File(base, "original-avatars").toPath());
    java.nio.file.Path outside = Files.createTempDirectory("qiban-outside-avatar-swap");
    java.nio.file.Path preserved = outside.resolve("lin.png");
    byte[] source = picture(10, 10, Bitmap.CompressFormat.PNG, Color.BLUE);
    Files.write(preserved, source);
    Files.createSymbolicLink(owned, outside);
    assertThrows(IllegalArgumentException.class, store::list);
    assertThrows(IllegalArgumentException.class, () -> store.importImage("lin", source));
    assertThrows(IllegalArgumentException.class, () -> store.delete("lin"));
    assertThrows(IllegalArgumentException.class, store::deleteAll);
    assertArrayEquals(source, Files.readAllBytes(preserved));
    assertEquals(1, outside.toFile().listFiles().length);
  }
}
