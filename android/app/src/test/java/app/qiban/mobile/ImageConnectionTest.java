package app.qiban.mobile;

import static org.junit.Assert.*;

import java.util.*;
import org.json.*;
import org.junit.Test;

public class ImageConnectionTest {
  private JSONObject image(int n, int size) {
    return ConnectionService.object(
        "id",
        String.format(Locale.ROOT, "image-%08x-0000-0000-0000-000000000000", n),
        "mimeType",
        "image/jpeg",
        "byteLength",
        size,
        "width",
        1,
        "height",
        1);
  }

  private JSONObject persona() {
    return ConnectionService.object(
        "name",
        "伙伴",
        "description",
        "",
        "personality",
        "",
        "scenario",
        "",
        "firstMessage",
        "你好",
        "exampleDialogue",
        "");
  }

  private JSONObject user(String text, JSONObject image) {
    return image == null
        ? ConnectionService.object("role", "user", "content", text)
        : ConnectionService.object("role", "user", "content", text, "image", image);
  }

  private JSONObject request(JSONArray messages) {
    return ConnectionService.object("characterId", "lin", "messages", messages);
  }

  private ChatImageStore.StoredImage stored(JSONObject image) {
    byte[] bytes = new byte[image.optInt("byteLength")];
    Arrays.fill(bytes, (byte) 255);
    return new ChatImageStore.StoredImage(image, bytes);
  }

  private ConnectionService.PreparedImageRequest prepare(
      JSONObject request, ConnectionService.ImageResolver resolver) throws Exception {
    return ConnectionService.prepareImageModelRequest(
        request, persona(), "deepseek-flash", true, resolver, new NativeHttp.Cancellation());
  }

  @Test
  public void imageOnlyUsesInlinePartsAndExcludesReferences() throws Exception {
    JSONObject image = image(1, 3);
    JSONObject request = request(new JSONArray().put(user("", image)));
    String original = request.toString();
    ConnectionService.PreparedImageRequest prepared =
        prepare(
            request,
            (owner, metadata) -> {
              assertEquals("lin", owner);
              return stored(metadata);
            });
    JSONArray content =
        prepared.body.getJSONArray("messages").getJSONObject(3).getJSONArray("content");
    assertEquals("", content.getJSONObject(0).getString("text"));
    assertEquals(
        "data:image/jpeg;base64,////",
        content.getJSONObject(1).getJSONObject("image_url").getString("url"));
    assertEquals(
        "original", content.getJSONObject(1).getJSONObject("image_url").getString("detail"));
    assertFalse(prepared.body.toString().contains(image.getString("id")));
    assertFalse(prepared.body.toString().contains("byteLength"));
    assertEquals(0, prepared.omittedImageIds.length());
    assertEquals(original, request.toString());
  }

  @Test
  public void retainsNewestThreeAndAddsExactOmissionMarker() throws Exception {
    JSONArray turns = new JSONArray();
    for (int i = 1; i <= 4; i++) {
      if (i > 1) turns.put(ConnectionService.object("role", "assistant", "content", "回复"));
      turns.put(user("第" + i + "张", image(i, 3)));
    }
    JSONObject request = request(turns);
    String original = request.toString();
    List<String> reads = new ArrayList<>();
    ConnectionService.PreparedImageRequest prepared =
        prepare(
            request,
            (owner, metadata) -> {
              reads.add(metadata.getString("id"));
              return stored(metadata);
            });
    assertEquals(3, reads.size());
    assertEquals(image(2, 3).getString("id"), reads.get(0));
    assertEquals(image(1, 3).getString("id"), prepared.omittedImageIds.getString(0));
    assertEquals(
        "第1张\n" + ConnectionService.IMAGE_OMISSION_TEXT,
        prepared.body.getJSONArray("messages").getJSONObject(3).getString("content"));
    assertEquals(original, request.toString());
  }

  @Test
  public void rejectsUntrustedMetadataRolesAndProvider() throws Exception {
    JSONObject image = image(1, 3);
    image.put("url", "https://example.com/secret");
    try {
      prepare(
          request(new JSONArray().put(user("看图", image))), (owner, metadata) -> stored(metadata));
      fail();
    } catch (IllegalArgumentException expected) {
    }
    JSONArray turns =
        new JSONArray()
            .put(user("你好", null))
            .put(
                ConnectionService.object(
                    "role", "assistant", "content", "回复", "image", image(1, 3)))
            .put(user("继续", null));
    try {
      prepare(request(turns), (owner, metadata) -> stored(metadata));
      fail();
    } catch (IllegalArgumentException expected) {
    }
    JSONObject good = request(new JSONArray().put(user("看图", image(1, 3))));
    try {
      ConnectionService.prepareImageModelRequest(
          good,
          persona(),
          "other-model",
          true,
          (owner, metadata) -> stored(metadata),
          new NativeHttp.Cancellation());
      fail();
    } catch (IllegalArgumentException expected) {
    }
    try {
      ConnectionService.prepareImageModelRequest(
          good,
          persona(),
          "deepseek-flash",
          false,
          (owner, metadata) -> stored(metadata),
          new NativeHttp.Cancellation());
      fail();
    } catch (IllegalArgumentException expected) {
    }
  }

  @Test
  public void ownershipFailureAndMetadataMismatchNeverProduceBody() throws Exception {
    JSONObject good = request(new JSONArray().put(user("看图", image(1, 3))));
    try {
      prepare(
          good,
          (owner, metadata) -> {
            throw new IllegalArgumentException("secret-path");
          });
      fail();
    } catch (IllegalArgumentException expected) {
      assertFalse(expected.getMessage().contains("secret-path"));
    }
    try {
      prepare(good, (owner, metadata) -> new ChatImageStore.StoredImage(image(2, 3), new byte[3]));
      fail();
    } catch (IllegalArgumentException expected) {
    }
    try {
      prepare(good, (owner, metadata) -> new ChatImageStore.StoredImage(metadata, new byte[4]));
      fail();
    } catch (IllegalArgumentException expected) {
    }
  }

  @Test
  public void personaTrimIncludesImageIdsFromDroppedTurns() throws Exception {
    JSONArray turns =
        new JSONArray()
            .put(user("oldest", image(1, 3)))
            .put(ConnectionService.object("role", "assistant", "content", "a".repeat(8000)))
            .put(user("middle", image(2, 3)))
            .put(ConnectionService.object("role", "assistant", "content", "b".repeat(8000)))
            .put(user("latest", image(3, 3)));
    JSONObject p = persona();
    p.put("description", "d".repeat(20000));
    List<String> reads = new ArrayList<>();
    ConnectionService.PreparedImageRequest prepared =
        ConnectionService.prepareImageModelRequest(
            request(turns),
            p,
            "deepseek-flash",
            true,
            (owner, metadata) -> {
              reads.add(metadata.getString("id"));
              return stored(metadata);
            },
            new NativeHttp.Cancellation());
    assertEquals(2, reads.size());
    assertEquals(image(1, 3).getString("id"), prepared.omittedImageIds.getString(0));
    assertEquals(6, prepared.body.getJSONArray("messages").length());
  }

  @Test
  public void cancellationDuringResolutionStopsEncodingAndFurtherReads() throws Exception {
    NativeHttp.Cancellation token = new NativeHttp.Cancellation();
    JSONObject good = request(new JSONArray().put(user("看图", image(1, 3))));
    try {
      ConnectionService.prepareImageModelRequest(
          good,
          persona(),
          "deepseek-flash",
          true,
          (owner, metadata) -> {
            token.cancel();
            return stored(metadata);
          },
          token);
      fail();
    } catch (NativeHttp.Failure expected) {
      assertEquals("cancelled", expected.code);
    }
    try {
      ConnectionService.encodeImage(new byte[1024], token);
      fail();
    } catch (NativeHttp.Failure expected) {
      assertEquals("cancelled", expected.code);
    }
  }

  @Test
  public void maximumRawContextAndBase64RemainBounded() throws Exception {
    JSONArray turns = new JSONArray();
    for (int i = 1; i <= 3; i++) {
      if (i > 1) turns.put(ConnectionService.object("role", "assistant", "content", "回复"));
      turns.put(user("看图", image(i, 1024 * 1024)));
    }
    ConnectionService.PreparedImageRequest prepared =
        prepare(request(turns), (owner, metadata) -> stored(metadata));
    assertEquals(0, prepared.omittedImageIds.length());
    assertTrue(
        ConnectionService.utf8(prepared.body.toString())
            <= ConnectionService.MAX_IMAGE_PROVIDER_BYTES);
    // Android's JSONObject can escape every slash; the full transport cap includes that overhead.
    assertTrue(
        ConnectionService.utf8(prepared.body.toString().replace("/", "\\/"))
            <= ConnectionService.MAX_IMAGE_PROVIDER_BYTES);
    JSONObject tooLarge = image(1, 1024 * 1024 + 1);
    assertFalse(ConnectionService.validImage(tooLarge));
  }

  @Test
  public void textOnlyBodyMatchesExistingContract() throws Exception {
    JSONObject request = request(new JSONArray().put(user("你好", null)));
    JSONObject expected =
        ConnectionService.modelRequest(request, persona(), "deepseek-flash", true);
    ConnectionService.PreparedImageRequest actual =
        prepare(
            request,
            (owner, metadata) -> {
              fail("text-only must not resolve images");
              return null;
            });
    assertEquals(expected.toString(), actual.body.toString());
    assertEquals(0, actual.omittedImageIds.length());
  }

  @Test
  public void oldSerializerRejectsImageAndOmissionEvenWithoutResolver() throws Exception {
    JSONObject imageRequest = request(new JSONArray().put(user("look", image(1, 3))));
    try {
      ConnectionService.modelRequest(imageRequest, persona(), "deepseek-flash", true);
      fail();
    } catch (IllegalArgumentException expected) {
    }
    JSONObject omitted = user("", null);
    omitted.put("imageOmitted", true);
    ConnectionService.PreparedImageRequest result =
        prepare(request(new JSONArray().put(omitted)), null);
    assertEquals(
        "\n" + ConnectionService.IMAGE_OMISSION_TEXT,
        result.body.getJSONArray("messages").getJSONObject(3).getString("content"));
  }

  @Test
  public void malformedOlderReferenceIsRejectedBeforeOmission() throws Exception {
    JSONArray turns = new JSONArray();
    for (int i = 1; i <= 4; i++) {
      if (i > 1) turns.put(ConnectionService.object("role", "assistant", "content", "reply"));
      turns.put(user("look", image(i, 3)));
    }
    turns.getJSONObject(0).getJSONObject("image").put("height", 1601);
    try {
      prepare(
          request(turns),
          (owner, metadata) -> {
            fail("invalid input must not resolve");
            return null;
          });
      fail();
    } catch (IllegalArgumentException expected) {
    }
  }
}
