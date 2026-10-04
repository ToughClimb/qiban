package app.qiban.mobile;

import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import okhttp3.*;
import org.json.JSONObject;

/** HTTPS only, public DNS answers pinned by OkHttp's per-request resolver. */
public final class NativeHttp {
  static final String NETWORK = "连接不上此服务，请检查地址和网络后重试。";
  static final String URL_ERROR = "请填写公开的 HTTPS 服务地址，不能包含账号、查询参数或片段。";

  static final class Failure extends IOException {
    final String code;

    Failure(String code, String text) {
      super(text);
      this.code = code;
    }
  }

  static final class Cancellation {
    volatile boolean cancelled;
    volatile Call call;

    void cancel() {
      cancelled = true;
      Call c = call;
      if (c != null) c.cancel();
    }
  }

  private static final ExecutorService DNS =
      new ThreadPoolExecutor(
          0,
          2,
          30,
          TimeUnit.SECONDS,
          new SynchronousQueue<>(),
          r -> {
            Thread t = new Thread(r, "qiban-dns");
            t.setDaemon(true);
            return t;
          },
          new ThreadPoolExecutor.AbortPolicy());

  static String normalize(String value) {
    try {
      if (value == null || value.length() > 2048) throw new Exception();
      String text = value.trim();
      if (text.matches(".*[\\x00-\\x20\\\\].*")) throw new Exception();
      URI u = new URI(text);
      String host = u.getHost();
      if (!"https".equalsIgnoreCase(u.getScheme())
          || host == null
          || u.getRawUserInfo() != null
          || u.getRawQuery() != null
          || u.getRawFragment() != null
          || u.getPort() == 0
          || u.getPort() > 65535) throw new Exception();
      host = host.toLowerCase(Locale.ROOT);
      String path = u.getRawPath() == null ? "" : u.getRawPath();
      if (path.toLowerCase(Locale.ROOT).matches(".*%(2f|5c|00).*")) throw new Exception();
      String plainHost = host.replace("[", "").replace("]", "");
      if (host.equals("localhost")
          || host.endsWith(".localhost")
          || host.endsWith(".local")
          || !host.contains(".") && !host.contains(":")) throw new Exception();
      if ((plainHost.matches("[0-9.]+") || plainHost.contains(":"))
          && !isPublic(InetAddress.getByName(plainHost))) throw new Exception();
      path = path.replaceAll("/chat/completions/?$", "").replaceAll("/+$", "");
      return "https://"
          + host
          + (u.getPort() == -1 || u.getPort() == 443 ? "" : ":" + u.getPort())
          + path;
    } catch (Exception e) {
      throw new IllegalArgumentException(URL_ERROR);
    }
  }

  static boolean isPublic(InetAddress address) {
    byte[] b = address.getAddress();
    if (b.length == 4) {
      int a = b[0] & 255, c = b[1] & 255, d = b[2] & 255;
      return !(a == 0
          || a == 10
          || a == 127
          || a >= 224
          || a == 100 && c >= 64 && c <= 127
          || a == 169 && c == 254
          || a == 172 && c >= 16 && c <= 31
          || a == 192 && (c == 168 || c == 0 || c == 2)
          || a == 198 && (c == 18 || c == 19 || c == 51 && d == 100)
          || a == 203 && c == 0 && d == 113);
    }
    return b.length == 16
        && (b[0] & 224) == 32
        && !((b[0] & 255) == 32
            && (b[1] & 255) == 1
            && ((b[2] == 0 && b[3] == 0) || (b[2] & 255) == 13 && (b[3] & 255) == 184))
        && !((b[0] & 255) == 32 && (b[1] & 255) == 2);
  }

  static List<InetAddress> publicAddresses(InetAddress[] addresses) throws UnknownHostException {
    if (addresses.length == 0 || Arrays.stream(addresses).anyMatch(a -> !isPublic(a))) {
      throw new UnknownHostException(URL_ERROR);
    }
    return Arrays.asList(addresses);
  }

  JSONObject request(String url, String key, JSONObject body, Cancellation token)
      throws IOException {
    try {
      return requestInternal(url, key, body, token);
    } catch (Failure e) {
      throw e;
    } catch (Exception e) {
      throw new Failure(
          token.cancelled ? "cancelled" : "network", token.cancelled ? "已取消这次连接。" : NETWORK);
    }
  }

  private JSONObject requestInternal(String url, String key, JSONObject body, Cancellation token)
      throws IOException {
    if (token.cancelled) throw new Failure("cancelled", "已取消这次连接。");
    long timeout = body == null ? 10000 : 25000;
    OkHttpClient client =
        new OkHttpClient.Builder()
            .proxy(Proxy.NO_PROXY)
            .followRedirects(false)
            .followSslRedirects(false)
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(timeout, TimeUnit.MILLISECONDS)
            .writeTimeout(timeout, TimeUnit.MILLISECONDS)
            .callTimeout(timeout, TimeUnit.MILLISECONDS)
            .dns(
                host -> {
                  Future<InetAddress[]> task;
                  try {
                    task = DNS.submit(() -> InetAddress.getAllByName(host));
                  } catch (Exception e) {
                    throw new UnknownHostException(NETWORK);
                  }
                  try {
                    InetAddress[] addresses = task.get(5, TimeUnit.SECONDS);
                    return publicAddresses(addresses);
                  } catch (Exception e) {
                    task.cancel(true);
                    throw new UnknownHostException(NETWORK);
                  }
                })
            .build();
    Request.Builder builder =
        new Request.Builder()
            .url(url)
            .header("Authorization", "Bearer " + key)
            .header("Accept", "application/json");
    if (body != null) {
      String json = body.toString();
      if (ConnectionService.utf8(json) > ConnectionService.MAX_IMAGE_PROVIDER_BYTES)
        throw new Failure("input", "消息与图片过大，请编辑后重试。");
      if (token.cancelled) throw new Failure("cancelled", "已取消这次连接。");
      builder.post(RequestBody.create(json, MediaType.get("application/json; charset=utf-8")));
    }
    Call call = client.newCall(builder.build());
    token.call = call;
    if (token.cancelled) call.cancel();
    try (Response response = call.execute()) {
      int status = response.code();
      if (status >= 300) {
        if (status < 400) throw new Failure("redirect", "服务要求跳转，连接已停止，请填写最终服务地址。");
        if (status == 401 || status == 403) throw new Failure("auth", "密钥不正确或没有访问权限，请检查后重试。");
        if (status == 404 || status == 405)
          throw new Failure(body == null ? "discovery" : "unsupported", "这个地址不支持此功能，请检查服务地址。");
        throw new Failure("unavailable", status == 429 ? "服务请求较多，请稍后再试。" : "服务暂时不可用，请稍后重试。");
      }
      if (response.body() == null) throw new Failure("unsupported", "服务没有返回兼容的数据。");
      ByteArrayOutputStream out = new ByteArrayOutputStream();
      try (InputStream in = response.body().byteStream()) {
        byte[] buffer = new byte[4096];
        int count;
        while ((count = in.read(buffer)) != -1) {
          if (out.size() + count > 128 * 1024) throw new Failure("unsupported", "服务回复过大，无法读取。");
          out.write(buffer, 0, count);
        }
      }
      if (token.cancelled) throw new Failure("cancelled", "已取消这次连接。");
      try {
        return new JSONObject(out.toString(StandardCharsets.UTF_8.name()));
      } catch (Exception e) {
        throw new Failure("unsupported", "服务没有返回兼容的数据。");
      }
    } catch (Failure e) {
      throw e;
    } catch (Exception e) {
      throw new Failure(
          token.cancelled ? "cancelled" : "network", token.cancelled ? "已取消这次连接。" : NETWORK);
    } finally {
      token.call = null;
      client.connectionPool().evictAll();
      client.dispatcher().executorService().shutdown();
    }
  }
}
