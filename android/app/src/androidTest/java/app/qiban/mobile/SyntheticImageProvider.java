package app.qiban.mobile;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.ByteArrayOutputStream;
import java.io.FileNotFoundException;
import java.io.IOException;

/** Instrumentation APK only: an immutable synthetic one-pixel image, never a path proxy. */
public final class SyntheticImageProvider extends ContentProvider {
  static final Uri PIXEL = Uri.parse("content://app.qiban.mobile.test.images/pixel");

  private static byte[] pixel() {
    Bitmap image = Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888);
    image.eraseColor(Color.BLUE);
    try {
      ByteArrayOutputStream output = new ByteArrayOutputStream();
      if (!image.compress(Bitmap.CompressFormat.PNG, 100, output))
        throw new IllegalStateException();
      return output.toByteArray();
    } finally {
      image.recycle();
    }
  }

  @Override
  public boolean onCreate() {
    return true;
  }

  @Override
  public String getType(Uri uri) {
    return PIXEL.equals(uri) ? "image/png" : null;
  }

  @Override
  public Cursor query(Uri uri, String[] projection, String selection, String[] args, String sort) {
    if (!PIXEL.equals(uri)) throw new IllegalArgumentException();
    MatrixCursor cursor =
        new MatrixCursor(new String[] {OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE});
    cursor.addRow(new Object[] {"synthetic-pixel.png", pixel().length});
    return cursor;
  }

  @Override
  public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
    if (!PIXEL.equals(uri) || !"r".equals(mode)) throw new FileNotFoundException();
    try {
      ParcelFileDescriptor[] pipe = ParcelFileDescriptor.createPipe();
      byte[] bytes = pixel();
      new Thread(
              () -> {
                try (ParcelFileDescriptor.AutoCloseOutputStream output =
                    new ParcelFileDescriptor.AutoCloseOutputStream(pipe[1])) {
                  output.write(bytes);
                } catch (IOException ignored) {
                  /* Consumer cancellation closes this test-only pipe. */
                }
              },
              "qiban-test-pixel")
          .start();
      return pipe[0];
    } catch (IOException error) {
      throw new FileNotFoundException();
    }
  }

  @Override
  public Uri insert(Uri uri, ContentValues values) {
    throw new UnsupportedOperationException();
  }

  @Override
  public int update(Uri uri, ContentValues values, String selection, String[] args) {
    throw new UnsupportedOperationException();
  }

  @Override
  public int delete(Uri uri, String selection, String[] args) {
    throw new UnsupportedOperationException();
  }
}
