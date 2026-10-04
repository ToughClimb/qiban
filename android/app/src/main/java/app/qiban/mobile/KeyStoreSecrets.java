package app.qiban.mobile;

import android.content.Context;
import android.security.keystore.*;
import android.util.AtomicFile;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.*;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;

final class KeyStoreSecrets {
  private static final String ALIAS = "qiban.connection.v1";
  private final AtomicFile file;

  KeyStoreSecrets(Context c) {
    file = new AtomicFile(new File(c.getFilesDir(), "connection.enc"));
  }

  private SecretKey key(boolean create) throws Exception {
    KeyStore s = KeyStore.getInstance("AndroidKeyStore");
    s.load(null);
    if (s.containsAlias(ALIAS)) return (SecretKey) s.getKey(ALIAS, null);
    if (!create) throw new IOException();
    KeyGenerator g = KeyGenerator.getInstance("AES", "AndroidKeyStore");
    g.init(
        new KeyGenParameterSpec.Builder(
                ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true)
            .build());
    return g.generateKey();
  }

  synchronized JSONObject load() throws Exception {
    if (!file.getBaseFile().exists()) return null;
    ByteArrayOutputStream bytes = new ByteArrayOutputStream();
    try (InputStream input = file.openRead()) {
      byte[] buffer = new byte[4096];
      int count;
      while ((count = input.read(buffer)) != -1) {
        if (bytes.size() + count > 65536) throw new IOException();
        bytes.write(buffer, 0, count);
      }
    }
    byte[] b = bytes.toByteArray();
    if (b.length < 29 || b.length > 65536 || b[0] != 1) throw new IOException();
    Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
    c.init(Cipher.DECRYPT_MODE, key(false), new GCMParameterSpec(128, b, 1, 12));
    return new JSONObject(new String(c.doFinal(b, 13, b.length - 13), StandardCharsets.UTF_8));
  }

  synchronized void save(JSONObject s) throws Exception {
    Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
    c.init(Cipher.ENCRYPT_MODE, key(true));
    byte[] plaintext = s.toString().getBytes(StandardCharsets.UTF_8);
    if (plaintext.length > 65507 || c.getIV().length != 12) throw new IOException();
    byte[] b;
    try {
      b = c.doFinal(plaintext);
    } finally {
      java.util.Arrays.fill(plaintext, (byte) 0);
    }
    FileOutputStream out = null;
    try {
      out = file.startWrite();
      out.write(1);
      out.write(c.getIV());
      out.write(b);
      file.finishWrite(out);
    } catch (Exception e) {
      if (out != null) file.failWrite(out);
      throw e;
    }
  }

  synchronized void clear() throws Exception {
    file.delete();
    KeyStore s = KeyStore.getInstance("AndroidKeyStore");
    s.load(null);
    if (s.containsAlias(ALIAS)) s.deleteEntry(ALIAS);
  }
}
