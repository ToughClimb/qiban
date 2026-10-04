package app.qiban.mobile;

import android.app.AlertDialog;
import android.content.Intent;
import android.net.Uri;
import android.text.InputType;
import android.view.WindowManager;
import android.widget.EditText;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.*;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.*;
import org.json.*;

@CapacitorPlugin(name = "Qiban")
public class QibanPlugin extends Plugin {
  private final ExecutorService worker = Executors.newSingleThreadExecutor();
  private final ExecutorService chats = Executors.newFixedThreadPool(2);
  private ConnectionService connection;
  private DataStore data;
  private AvatarStore avatars;
  private ChatImageStore chatImages;
  private volatile boolean destroyed;
  private PluginCall pendingPickerCall;
  private final java.util.Set<InputStream> openImports =
      java.util.Collections.synchronizedSet(new java.util.HashSet<>());
  private String pendingExport;
  private boolean pickerBusy;
  private String pendingChatImageOwner;
  private long pendingChatImageGeneration;
  private boolean keyDialogBusy;
  private AlertDialog keyDialog;
  private EditText keyInput;
  private PluginCall keyCall;
  private final java.util.concurrent.atomic.AtomicLong completed =
      new java.util.concurrent.atomic.AtomicLong();
  private final java.util.concurrent.atomic.AtomicLong failed =
      new java.util.concurrent.atomic.AtomicLong();
  // Only reviewed, fixed native messages may cross the bridge; library details stay native.
  private static final java.util.Set<String> SAFE_ERRORS =
      java.util.Collections.unmodifiableSet(
          new java.util.HashSet<>(
              java.util.Arrays.asList(
                  "容量超限",
                  "密钥不正确或没有访问权限，请检查后重试。",
                  "已保存的密钥无法读取，请重新填写。",
                  "已取消这次连接。",
                  "无法保存聊天记录",
                  "无法保存角色卡；原有数据已保留",
                  "无法创建本地数据目录",
                  "无法删除角色卡",
                  "无法安全保存连接设置，请重试。",
                  "无法清除本地数据",
                  "无法读取本地数据",
                  "无法读取角色卡",
                  "服务回复过大，无法读取。",
                  "服务暂时不可用，请稍后重试。",
                  "服务没有返回兼容的数据。",
                  "服务没有返回可读的聊天回复，请检查服务设置后重试。",
                  "服务要求跳转，连接已停止，请填写最终服务地址。",
                  "服务请求较多，请稍后再试。",
                  "本地角色卡容量已满",
                  "正在检查连接，请稍等。",
                  "正在等待回复，请稍等。",
                  "消息太长或格式不正确，请编辑后重试。",
                  "聊天内容长度无效",
                  "聊天模式无效",
                  "聊天记录字段无效",
                  "聊天记录损坏，请先备份或清除本地数据",
                  "聊天记录格式无效",
                  "聊天记录结构无效",
                  "聊天记录超过容量限制",
                  "聊天记录过长",
                  "角色卡不是有效的安全 JSON 数据",
                  "角色卡列表内容无效",
                  "角色卡列表无效",
                  "角色卡列表过长",
                  "角色卡包含不安全或重复字段",
                  "角色卡字段类型或长度无效",
                  "角色卡文本过长",
                  "角色卡格式无效",
                  "角色卡版本不受支持",
                  "角色卡结构超过限制",
                  "角色卡缺少名称",
                  "角色卡超过大小限制",
                  "角色标识无效",
                  "角色设定与消息过长，请缩短角色设定或编辑这条消息后重试。",
                  "请填写公开的 HTTPS 服务地址，不能包含账号、查询参数或片段。",
                  "请填写有效的 API 密钥。更换地址时需重新填写密钥。",
                  "请选择服务提供的模型，或填写服务方给出的模型名称。",
                  "这个地址不支持此功能，请检查服务地址。",
                  "这个地址没有返回兼容的模型列表。",
                  "连接不上此服务，请检查地址和网络后重试。",
                  "仅支持 PNG、JPEG 或 WebP 图片",
                  "图片尺寸或格式无效",
                  "图片超过 5 MiB 限制",
                  "头像文件损坏",
                  "头像角色标识无效",
                  "无法保存头像；原有数据已保留",
                  "无法创建头像目录",
                  "无法删除头像",
                  "无法清除头像",
                  "无法读取图片",
                  "无法读取头像",
                  "无法转换头像",
                  "本地头像容量已满",
                  "转换后的头像超过容量限制",
                  "不支持动画图片",
                  "仅支持静态 PNG、JPEG 或 WebP 聊天图片",
                  "图片无法安全读取，请重新选择图片后重试。",
                  "图片聊天需要支持图片的 DeepSeek 服务和 deepseek-flash 模型。",
                  "聊天已清空，请重新选择图片。",
                  "无法保存聊天图片",
                  "无法创建聊天图片目录",
                  "无法删除聊天图片草稿",
                  "无法清除会话图片",
                  "无法清除聊天图片",
                  "无法读取聊天图片",
                  "无法转换聊天图片",
                  "本地聊天图片容量已满",
                  "演示模式暂不支持图片聊天，请先连接支持图片的服务。",
                  "聊天图片尺寸或格式无效",
                  "聊天图片引用与文件不一致",
                  "聊天图片引用格式无效",
                  "聊天图片所属角色无效",
                  "聊天图片文件损坏",
                  "聊天图片标识无效",
                  "聊天图片格式无效",
                  "聊天图片清理未完成",
                  "聊天图片缺失或损坏",
                  "聊天图片读取已取消",
                  "聊天图片超过 5 MiB 限制",
                  "转换后的聊天图片超过容量限制")));
  private static final int MAX_AVATAR_BYTES = 5 * 1024 * 1024;
  private static final java.util.regex.Pattern AVATAR_ID =
      java.util.regex.Pattern.compile(
          "(?:lin|tao|dou|moon|card-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})");
  private static final int MAX_CARD_BYTES = 128 * 1024;

  interface Work {
    Object run() throws Exception;
  }

  @Override
  public void load() {
    data = new DataStore(getContext());
    avatars = new AvatarStore(getContext());
    chatImages = new ChatImageStore(getContext());
    connection = new ConnectionService(getContext(), chatImages);
  }

  private void ok(PluginCall call, Object value) {
    completed.incrementAndGet();
    JSObject result = new JSObject();
    result.put("ok", true);
    result.put("value", value == null ? JSONObject.NULL : value);
    call.resolve(result);
  }

  private void fail(PluginCall call, String error) {
    failed.incrementAndGet();
    JSObject result = new JSObject();
    result.put("ok", false);
    result.put("error", error);
    call.resolve(result);
  }

  private String safeError(Exception error) {
    String message = error.getMessage();
    if ((error instanceof IllegalArgumentException || error instanceof NativeHttp.Failure)
        && SAFE_ERRORS.contains(message)) {
      return message;
    }
    return "操作未完成，请检查设置后重试。";
  }

  private void run(PluginCall call, Work work) {
    worker.execute(
        () -> {
          try {
            Object value = work.run();
            if (value != Deferred.VALUE) ok(call, value);
          } catch (Exception error) {
            fail(call, safeError(error));
          }
        });
  }

  private String required(PluginCall call, String key) throws Exception {
    String value = call.getString(key);
    if (value == null || value.isEmpty()) throw new Exception("missing");
    return value;
  }

  @PluginMethod
  public void status(PluginCall call) {
    run(call, () -> connection.status());
  }

  @PluginMethod
  public void connect(PluginCall call) {
    run(
        call,
        () -> {
          boolean prompt =
              Boolean.TRUE.equals(call.getBoolean("promptForKey", false))
                  || !connection.status().optBoolean("hasKey");
          if (prompt) {
            getActivity().runOnUiThread(() -> showKey(call));
            return Deferred.VALUE;
          }
          return connection.connect(
              required(call, "baseUrl"),
              Boolean.TRUE.equals(call.getBoolean("remember", false)),
              null);
        });
  }

  private void showKey(PluginCall call) {
    if (keyDialogBusy) {
      fail(call, "请先完成密钥输入。");
      return;
    }
    if (destroyed) {
      fail(call, "已取消连接。");
      return;
    }
    keyDialogBusy = true;
    keyCall = call;
    EditText input = new EditText(getContext());
    keyInput = input;
    input.setSingleLine(true);
    input.setInputType(
        InputType.TYPE_CLASS_TEXT
            | InputType.TYPE_TEXT_VARIATION_PASSWORD
            | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
    input.setFilters(
        new android.text.InputFilter[] {new android.text.InputFilter.LengthFilter(4096)});
    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
      input.setImeOptions(android.view.inputmethod.EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING);
      input.setImportantForAutofill(
          android.view.View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
    }
    AlertDialog dialog =
        new AlertDialog.Builder(getActivity())
            .setTitle("输入连接密钥")
            .setView(input)
            .setPositiveButton(
                "连接",
                (d, w) -> {
                  keyDialogBusy = false;
                  keyCall = null;
                  String key = input.getText().toString();
                  input.setText("");
                  run(
                      call,
                      () ->
                          connection.connect(
                              required(call, "baseUrl"),
                              Boolean.TRUE.equals(call.getBoolean("remember", false)),
                              key));
                })
            .setNegativeButton(
                "取消",
                (d, w) -> {
                  keyDialogBusy = false;
                  keyCall = null;
                  input.setText("");
                  fail(call, "已取消连接。");
                })
            .create();
    dialog.setOnCancelListener(
        d -> {
          keyDialogBusy = false;
          keyCall = null;
          input.setText("");
          fail(call, "已取消连接。");
        });
    keyDialog = dialog;
    dialog.setOnDismissListener(
        d -> {
          keyDialog = null;
          keyInput = null;
        });
    dialog.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
    dialog.show();
  }

  private enum Deferred {
    VALUE
  }

  @PluginMethod
  public void selectModel(PluginCall call) {
    run(call, () -> connection.selectModel(required(call, "model")));
  }

  @PluginMethod
  public void demo(PluginCall call) {
    run(call, () -> connection.demo());
  }

  @PluginMethod
  public void deleteKey(PluginCall call) {
    run(call, () -> connection.deleteKey());
  }

  @PluginMethod
  public void deleteData(PluginCall call) {
    connection.cancelAll();
    run(
        call,
        () -> {
          connection.deleteAll();
          data.deleteAll();
          avatars.deleteAll();
          chatImages.deleteAll();
          getActivity()
              .runOnUiThread(
                  () -> {
                    if (destroyed) {
                      fail(call, "已取消连接。");
                      return;
                    }
                    OriginStorageReset.clear(
                        getBridge().getWebView(),
                        cleared -> {
                          if (cleared && !destroyed) ok(call, null);
                          else fail(call, "无法清除网页本地数据，请重试。");
                        });
                  });
          return Deferred.VALUE;
        });
  }

  @PluginMethod
  public void loadHistory(PluginCall call) {
    run(
        call,
        () -> {
          JSONObject history = data.loadHistory();
          chatImages.commitHistory(history);
          return history;
        });
  }

  @PluginMethod
  public void saveHistory(PluginCall call) {
    run(
        call,
        () -> {
          JSONObject history = call.getObject("history");
          synchronized (chatImages) {
            chatImages.validateReferences(history);
            JSONObject previous = data.loadHistory();
            data.saveHistory(history);
            java.util.Iterator<String> owners = previous.keys();
            while (owners.hasNext()) {
              String owner = owners.next();
              if (!history.has(owner) || history.getJSONArray(owner).length() == 0) {
                connection.cancelAll();
                chatImages.deleteConversation(owner);
              } else if (ChatImageStore.tailRemovedOrChanged(
                  previous.getJSONArray(owner), history.getJSONArray(owner))) {
                connection.cancelStaleForHistory(owner, history.getJSONArray(owner));
                chatImages.invalidatePending(owner);
              }
            }
            chatImages.commitHistory(history);
          }
          return null;
        });
  }

  @PluginMethod
  public void listCards(PluginCall call) {
    run(
        call,
        () -> {
          JSONObject result = data.listCards();
          result.put("avatarUrls", avatars.list());
          return result;
        });
  }

  @PluginMethod
  public void saveCard(PluginCall call) {
    run(call, () -> data.saveCard(call.getString("id"), required(call, "raw")));
  }

  @PluginMethod
  public void deleteCard(PluginCall call) {
    run(
        call,
        () -> {
          String id = required(call, "id");
          connection.cancelAll();
          data.deleteCard(id);
          avatars.delete(id);
          chatImages.deleteConversation(id);
          return null;
        });
  }

  private void launchPicker(PluginCall call, Intent intent, String callback) {
    if (destroyed) {
      ok(call, null);
      return;
    }
    pickerBusy = true;
    pendingPickerCall = call;
    try {
      startActivityForResult(call, intent, callback);
    } catch (RuntimeException error) {
      pickerBusy = false;
      pendingPickerCall = null;
      pendingChatImageOwner = null;
      pendingExport = null;
      fail(call, "无法打开文件选择器，请稍后重试。");
    }
  }

  private String avatarId(PluginCall call) {
    String id = call.getString("id");
    if (id == null || !AVATAR_ID.matcher(id).matches())
      throw new IllegalArgumentException("角色标识无效");
    return id;
  }

  private byte[] readImport(Uri uri, int limit) throws IOException {
    if (uri == null || !"content".equals(uri.getScheme())) throw new IOException();
    InputStream stream = getContext().getContentResolver().openInputStream(uri);
    if (stream == null) throw new IOException();
    openImports.add(stream);
    try (InputStream input = stream;
        ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
      if (destroyed) throw new IOException();
      byte[] buffer = new byte[8192];
      int count;
      while ((count = input.read(buffer)) != -1) {
        if (destroyed || Thread.currentThread().isInterrupted()) throw new IOException();
        if (bytes.size() + count > limit)
          throw new IllegalArgumentException(
              limit == MAX_AVATAR_BYTES ? "图片超过 5 MiB 限制" : "角色卡超过大小限制");
        bytes.write(buffer, 0, count);
      }
      return bytes.toByteArray();
    } finally {
      openImports.remove(stream);
    }
  }

  @PluginMethod
  public void importAvatar(PluginCall call) {
    try {
      avatarId(call);
    } catch (Exception error) {
      fail(call, safeError(error));
      return;
    }
    getActivity()
        .runOnUiThread(
            () -> {
              if (pickerBusy) {
                fail(call, "请先完成当前文件操作。");
                return;
              }
              Intent intent =
                  new Intent(Intent.ACTION_OPEN_DOCUMENT)
                      .addCategory(Intent.CATEGORY_OPENABLE)
                      .setType("image/*")
                      .putExtra(
                          Intent.EXTRA_MIME_TYPES,
                          new String[] {"image/png", "image/jpeg", "image/webp"});
              launchPicker(call, intent, "avatarResult");
            });
  }

  @ActivityCallback
  private void avatarResult(PluginCall call, ActivityResult result) {
    pickerBusy = false;
    pendingPickerCall = null;
    if (call == null || destroyed) return;
    if (result.getResultCode() != android.app.Activity.RESULT_OK || result.getData() == null) {
      ok(call, null);
      return;
    }
    Uri uri = result.getData().getData();
    run(
        call,
        () -> {
          String id = avatarId(call);
          // A card may have been deleted while the system picker was open.
          if (id.startsWith("card-")) data.rawCard(id);
          return avatars.importImage(id, readImport(uri, MAX_AVATAR_BYTES));
        });
  }

  @PluginMethod
  public void deleteAvatar(PluginCall call) {
    run(
        call,
        () -> {
          avatars.delete(avatarId(call));
          return null;
        });
  }

  private String imageOwner(PluginCall call) {
    String owner = call.getString("characterId");
    if (owner == null || !AVATAR_ID.matcher(owner).matches())
      throw new IllegalArgumentException("角色标识无效");
    return owner;
  }

  @PluginMethod
  public void pickChatImage(PluginCall call) {
    final String owner;
    try {
      if (call.getData().length() != 1) throw new IllegalArgumentException();
      owner = imageOwner(call);
    } catch (Exception error) {
      fail(call, safeError(error));
      return;
    }
    getActivity()
        .runOnUiThread(
            () -> {
              if (pickerBusy || destroyed) {
                fail(call, "请先完成当前文件操作。");
                return;
              }
              pendingChatImageOwner = owner;
              pendingChatImageGeneration = chatImages.generation(owner);
              Intent intent =
                  new Intent(Intent.ACTION_OPEN_DOCUMENT)
                      .addCategory(Intent.CATEGORY_OPENABLE)
                      .setType("image/*")
                      .putExtra(
                          Intent.EXTRA_MIME_TYPES,
                          new String[] {"image/png", "image/jpeg", "image/webp"});
              launchPicker(call, intent, "chatImageResult");
            });
  }

  @ActivityCallback
  private void chatImageResult(PluginCall call, ActivityResult result) {
    final String owner = pendingChatImageOwner;
    final long generation = pendingChatImageGeneration;
    pickerBusy = false;
    pendingPickerCall = null;
    pendingChatImageOwner = null;
    if (call == null || destroyed) return;
    if (result.getResultCode() != android.app.Activity.RESULT_OK || result.getData() == null) {
      ok(call, null);
      return;
    }
    Uri uri = result.getData().getData();
    run(
        call,
        () -> {
          if (owner == null
              || !owner.equals(imageOwner(call))
              || generation != chatImages.generation(owner))
            throw new IllegalArgumentException("聊天已清空，请重新选择图片。");
          if (owner.startsWith("card-")) data.rawCard(owner);
          byte[] source = readImport(uri, MAX_AVATAR_BYTES);
          if (generation != chatImages.generation(owner))
            throw new IllegalArgumentException("聊天已清空，请重新选择图片。");
          return chatImages.importImage(owner, source);
        });
  }

  @PluginMethod
  public void chatImagePreview(PluginCall call) {
    run(
        call,
        () -> {
          if (call.getData().length() != 2) throw new IllegalArgumentException();
          return chatImages.preview(imageOwner(call), required(call, "imageId"));
        });
  }

  @PluginMethod
  public void discardChatImage(PluginCall call) {
    run(
        call,
        () -> {
          if (call.getData().length() != 2) throw new IllegalArgumentException();
          chatImages.discardDraft(imageOwner(call), required(call, "imageId"));
          return null;
        });
  }

  @PluginMethod
  public void importCard(PluginCall call) {
    getActivity()
        .runOnUiThread(
            () -> {
              if (pickerBusy) {
                fail(call, "请先完成当前文件操作。");
                return;
              }
              Intent intent =
                  new Intent(Intent.ACTION_OPEN_DOCUMENT)
                      .addCategory(Intent.CATEGORY_OPENABLE)
                      .setType("*/*");
              launchPicker(call, intent, "importResult");
            });
  }

  @ActivityCallback
  private void importResult(PluginCall call, ActivityResult result) {
    pickerBusy = false;
    pendingPickerCall = null;
    if (call == null || destroyed) return;
    if (result.getResultCode() != android.app.Activity.RESULT_OK || result.getData() == null) {
      ok(call, null);
      return;
    }
    Uri uri = result.getData().getData();
    run(
        call,
        () -> {
          byte[] bytes = readImport(uri, MAX_CARD_BYTES);
          JSObject value = new JSObject();
          value.put(
              "raw",
              StandardCharsets.UTF_8
                  .newDecoder()
                  .decode(java.nio.ByteBuffer.wrap(bytes))
                  .toString());
          return value;
        });
  }

  @PluginMethod
  public void exportCard(PluginCall call) {
    run(
        call,
        () -> {
          String raw = data.rawCard(required(call, "id"));
          getActivity()
              .runOnUiThread(
                  () -> {
                    if (pickerBusy) {
                      fail(call, "请先完成当前导出。");
                      return;
                    }
                    pendingExport = raw;
                    Intent intent =
                        new Intent(Intent.ACTION_CREATE_DOCUMENT)
                            .addCategory(Intent.CATEGORY_OPENABLE)
                            .setType("application/json")
                            .putExtra(Intent.EXTRA_TITLE, "角色卡.json");
                    launchPicker(call, intent, "exportResult");
                  });
          return Deferred.VALUE;
        });
  }

  @ActivityCallback
  private void exportResult(PluginCall call, ActivityResult result) {
    pickerBusy = false;
    pendingPickerCall = null;
    String raw = pendingExport;
    pendingExport = null;
    if (call == null || destroyed) return;
    if (result.getResultCode() != android.app.Activity.RESULT_OK || result.getData() == null) {
      ok(call, null);
      return;
    }
    Uri uri = result.getData().getData();
    run(
        call,
        () -> {
          if (uri == null || !"content".equals(uri.getScheme()) || raw == null)
            throw new IOException();
          try (OutputStream out = getContext().getContentResolver().openOutputStream(uri, "wt")) {
            if (out == null) throw new IOException();
            out.write(raw.getBytes(StandardCharsets.UTF_8));
          }
          return null;
        });
  }

  @PluginMethod
  public void openCards(PluginCall call) {
    getActivity()
        .runOnUiThread(
            () ->
                new AlertDialog.Builder(getActivity())
                    .setTitle("角色卡文件")
                    .setMessage("角色卡保存在应用私有空间。请使用导出功能，将角色卡保存到您选择的位置；文件管理器无法直接浏览应用私有空间。")
                    .setPositiveButton("知道了", (d, w) -> ok(call, null))
                    .setOnCancelListener(d -> ok(call, null))
                    .show());
  }

  @PluginMethod
  public void dataPath(PluginCall call) {
    ok(call, getContext().getFilesDir().getAbsolutePath());
  }

  @PluginMethod
  public void diagnostics(PluginCall call) {
    JSObject value = new JSObject();
    value.put("platform", "android");
    value.put("version", BuildConfig.VERSION_NAME);
    value.put("completedOperations", completed.get());
    value.put("failedOperations", failed.get());
    ok(call, value);
  }

  @PluginMethod
  public void chat(PluginCall call) {
    chats.execute(
        () -> {
          try {
            JSONObject request = call.getObject("request");
            String owner = request == null ? null : request.optString("characterId", null);
            if (owner == null || !AVATAR_ID.matcher(owner).matches())
              throw new IllegalArgumentException("角色标识无效");
            if (owner.startsWith("card-")) data.rawCard(owner);
            ok(call, connection.chat(request, call.getObject("persona"), required(call, "id")));
          } catch (Exception e) {
            fail(call, safeError(e));
          }
        });
  }

  @PluginMethod
  public void cancel(PluginCall call) {
    try {
      connection.cancel(required(call, "id"));
      ok(call, null);
    } catch (Exception e) {
      fail(call, "取消失败。");
    }
  }

  @Override
  protected void handleOnDestroy() {
    destroyed = true;
    if (keyInput != null) keyInput.setText("");
    if (keyCall != null) fail(keyCall, "已取消连接。");
    keyCall = null;
    if (keyDialog != null) keyDialog.dismiss();
    keyDialogBusy = false;
    if (pendingPickerCall != null) ok(pendingPickerCall, null);
    pendingPickerCall = null;
    pendingChatImageOwner = null;
    pendingExport = null;
    pickerBusy = false;
    synchronized (openImports) {
      for (InputStream stream : openImports) {
        try {
          stream.close();
        } catch (IOException ignored) {
        }
      }
      openImports.clear();
    }
    connection.cancelAll();
    worker.shutdownNow();
    chats.shutdownNow();
    super.handleOnDestroy();
  }
}
