package app.qiban.mobile;

import static org.junit.Assert.*;

import java.net.InetAddress;
import org.json.*;
import org.junit.Test;

public class ConnectionLogicTest {
  private JSONObject request() {
    return ConnectionService.object(
        "characterId",
        "lin",
        "messages",
        new JSONArray().put(ConnectionService.object("role", "user", "content", "你好")));
  }

  private JSONObject persona() {
    return ConnectionService.object(
        "name",
        "角色",
        "description",
        "描述",
        "personality",
        "性格",
        "scenario",
        "场景",
        "firstMessage",
        "你好",
        "exampleDialogue",
        "例子",
        "metadata",
        "never-in-context");
  }

  @Test
  public void canonicalEndpointAndUnsafeUrls() {
    assertEquals(
        "https://api.example.com/v1",
        NativeHttp.normalize(" https://api.example.com/v1/chat/completions/ "));
    for (String url :
        new String[] {
          "http://api.example.com",
          "https://user:synthetic@api.example.com",
          "https://api.example.com?key=synthetic",
          "https://localhost",
          "https://10.0.0.1",
          "https://[::1]",
          "https://api.example.com/%2fsecret",
          "https://api.example.com/#fragment",
          "https://api.example.com/\nsecret"
        }) {
      try {
        NativeHttp.normalize(url);
        fail(url);
      } catch (IllegalArgumentException expected) {
        assertFalse(expected.getMessage().contains("synthetic"));
      }
    }
  }

  @Test
  public void publicAddressRanges() throws Exception {
    for (String ip :
        new String[] {
          "127.0.0.1",
          "10.1.2.3",
          "100.64.1.2",
          "169.254.1.1",
          "172.31.1.1",
          "192.168.1.1",
          "198.18.1.1",
          "198.51.100.1",
          "203.0.113.1",
          "224.0.0.1",
          "::1",
          "fc00::1",
          "2001:db8::1",
          "2002::1",
          "2001::1"
        }) assertFalse(ip, NativeHttp.isPublic(InetAddress.getByName(ip)));
    assertTrue(NativeHttp.isPublic(InetAddress.getByName("8.8.8.8")));
    assertTrue(NativeHttp.isPublic(InetAddress.getByName("2606:4700:4700::1111")));
  }

  @Test
  public void rejectsInjectedAndMalformedTurns() throws Exception {
    JSONObject r = request();
    r.getJSONArray("messages").getJSONObject(0).put("role", "system");
    try {
      ConnectionService.validateMessages(r);
      fail();
    } catch (IllegalArgumentException expected) {
    }
    r = request();
    r.getJSONArray("messages").getJSONObject(0).put("tool_calls", new JSONArray());
    try {
      ConnectionService.validateMessages(r);
      fail();
    } catch (IllegalArgumentException expected) {
    }
    r = request();
    r.getJSONArray("messages").getJSONObject(0).put("content", "x".repeat(2001));
    try {
      ConnectionService.validateMessages(r);
      fail();
    } catch (IllegalArgumentException expected) {
    }
  }

  @Test
  public void personaIsLowerTrustAndMetadataNeverEntersBody() throws Exception {
    JSONObject body = ConnectionService.modelRequest(request(), persona(), "synthetic-model", true);
    assertFalse(body.toString().contains("never-in-context"));
    assertFalse(body.getBoolean("stream"));
    assertEquals(256, body.getInt("max_tokens"));
    JSONArray messages = body.getJSONArray("messages");
    assertEquals("system", messages.getJSONObject(0).getString("role"));
    assertEquals("user", messages.getJSONObject(1).getString("role"));
    assertEquals("disabled", body.getJSONObject("thinking").getString("type"));
  }

  @Test
  public void finalTextIgnoresReasoningToolsAndRejectsMissingContent() {
    JSONObject message =
        ConnectionService.object(
            "content",
            "\u00a0最终回复\ufeff",
            "reasoning_content",
            "secret-reasoning",
            "tool_calls",
            new JSONArray());
    JSONObject data =
        ConnectionService.object(
            "choices", new JSONArray().put(ConnectionService.object("message", message)));
    assertEquals("最终回复", ConnectionService.finalText(data));
    for (Object bad : new Object[] {JSONObject.NULL, 123, " ", "\u00a0\ufeff", "x".repeat(8001)}) {
      JSONObject invalid =
          ConnectionService.object(
              "choices",
              new JSONArray()
                  .put(
                      ConnectionService.object(
                          "message", ConnectionService.object("content", bad))));
      try {
        ConnectionService.finalText(invalid);
        fail();
      } catch (IllegalArgumentException expected) {
      }
    }
  }

  @Test
  public void rejectsControlCharactersInKeysAndModels() {
    assertFalse(ConnectionService.validKey("synthetic\nkey"));
    assertFalse(ConnectionService.validModel("synthetic\nmodel"));
    assertTrue(ConnectionService.validKey("synthetic-key-only"));
  }

  @Test
  public void mixedPublicPrivateDnsIsRejected() throws Exception {
    for (InetAddress[] addresses :
        new InetAddress[][] {
          new InetAddress[0], {InetAddress.getByName("8.8.8.8"), InetAddress.getByName("127.0.0.1")}
        }) {
      try {
        NativeHttp.publicAddresses(addresses);
        fail();
      } catch (java.net.UnknownHostException expected) {
      }
    }
  }

  @Test
  public void cancellationBeforeRequestNeverOpensNetwork() throws Exception {
    NativeHttp.Cancellation token = new NativeHttp.Cancellation();
    token.cancel();
    try {
      new NativeHttp().request("https://api.example.com/models", "synthetic-key-only", null, token);
      fail();
    } catch (NativeHttp.Failure expected) {
      assertEquals("cancelled", expected.code);
    }
  }

  @Test
  public void oversizedContextDropsCompleteOldTurnsOnly() throws Exception {
    JSONObject p = persona();
    p.put("description", "d".repeat(20000));
    JSONArray turns =
        new JSONArray()
            .put(ConnectionService.object("role", "user", "content", "oldest"))
            .put(ConnectionService.object("role", "assistant", "content", "a".repeat(8000)))
            .put(ConnectionService.object("role", "user", "content", "middle"))
            .put(ConnectionService.object("role", "assistant", "content", "b".repeat(8000)))
            .put(ConnectionService.object("role", "user", "content", "latest"));
    JSONObject body =
        ConnectionService.modelRequest(
            ConnectionService.object("characterId", "lin", "messages", turns),
            p,
            "synthetic-model",
            false);
    JSONArray messages = body.getJSONArray("messages");
    assertEquals(6, messages.length());
    assertEquals("middle", messages.getJSONObject(3).getString("content"));
    assertEquals("latest", messages.getJSONObject(5).getString("content"));
  }
}
