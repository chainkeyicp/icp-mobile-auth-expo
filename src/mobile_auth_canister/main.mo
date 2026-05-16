import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Buffer "mo:base/Buffer";
import HashMap "mo:base/HashMap";
import Iter "mo:base/Iter";
import Nat "mo:base/Nat";
import Nat8 "mo:base/Nat8";
import Principal "mo:base/Principal";
import Random "mo:base/Random";
import Text "mo:base/Text";
import Time "mo:base/Time";

import Assets "./Assets";

actor {
  type HeaderField = (Text, Text);

  type HttpRequest = {
    body : Blob;
    headers : [HeaderField];
    method : Text;
    url : Text;
    certificate_version : ?Nat16;
  };

  type StreamingCallbackToken = {
    key : Text;
    content_encoding : Text;
    index : Nat;
    sha256 : ?Blob;
  };

  type StreamingCallbackHttpResponse = {
    body : Blob;
    token : ?StreamingCallbackToken;
  };

  type StreamingStrategy = {
    #Callback : {
      token : StreamingCallbackToken;
      callback : shared query StreamingCallbackToken -> async StreamingCallbackHttpResponse;
    };
  };

  type HttpResponse = {
    body : Blob;
    headers : [HeaderField];
    status_code : Nat16;
    streaming_strategy : ?StreamingStrategy;
    upgrade : ?Bool;
  };

  type StoredCode = {
    state : Text;
    delegation : Text;
    expiresAt : Int;
  };

  public type DeviceRecord = {
    owner : Principal;
    device : Principal;
    device_name : Text;
    created_at : Int;
    last_seen_at : ?Int;
    revoked : Bool;
  };

  let codeTtlNs : Int = 60_000_000_000;
  let codes = HashMap.HashMap<Text, StoredCode>(16, Text.equal, Text.hash);
  stable var stableDevices : [(Principal, DeviceRecord)] = [];
  let devices = HashMap.HashMap<Principal, DeviceRecord>(16, Principal.equal, Principal.hash);
  let hexDigits : [Text] = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "a", "b", "c", "d", "e", "f"];

  system func preupgrade() {
    stableDevices := Iter.toArray(devices.entries());
  };

  system func postupgrade() {
    for ((device, record) in stableDevices.vals()) {
      devices.put(device, record);
    };
    stableDevices := [];
  };

  public shared({ caller }) func register_device(device : Principal, device_name : Text) : async ?DeviceRecord {
    if (Principal.isAnonymous(caller) or Principal.isAnonymous(device)) {
      return null;
    };

    let now = Time.now();

    switch (devices.get(device)) {
      case (?existing) {
        if (existing.owner != caller) {
          return null;
        };

        let updated : DeviceRecord = {
          owner = caller;
          device = device;
          device_name = normalizeDeviceLabel(device_name);
          created_at = existing.created_at;
          last_seen_at = existing.last_seen_at;
          revoked = false;
        };
        devices.put(device, updated);
        ?updated;
      };
      case null {
        let record : DeviceRecord = {
          owner = caller;
          device = device;
          device_name = normalizeDeviceLabel(device_name);
          created_at = now;
          last_seen_at = null;
          revoked = false;
        };
        devices.put(device, record);
        ?record;
      };
    };
  };

  public shared({ caller }) func device_login() : async ?DeviceRecord {
    switch (devices.get(caller)) {
      case null null;
      case (?record) {
        if (record.revoked) {
          return null;
        };

        let updated : DeviceRecord = {
          owner = record.owner;
          device = record.device;
          device_name = record.device_name;
          created_at = record.created_at;
          last_seen_at = ?Time.now();
          revoked = false;
        };
        devices.put(caller, updated);
        ?updated;
      };
    };
  };

  public shared query({ caller }) func my_devices() : async [DeviceRecord] {
    let mine = Buffer.Buffer<DeviceRecord>(0);

    for ((_, record) in devices.entries()) {
      if (record.owner == caller) {
        mine.add(record);
      };
    };

    Buffer.toArray(mine);
  };

  public shared({ caller }) func revoke_device(device : Principal) : async Bool {
    switch (devices.get(device)) {
      case null false;
      case (?record) {
        if (record.owner != caller) {
          return false;
        };

        devices.put(device, {
          owner = record.owner;
          device = record.device;
          device_name = record.device_name;
          created_at = record.created_at;
          last_seen_at = record.last_seen_at;
          revoked = true;
        });
        true;
      };
    };
  };

  public shared query({ caller }) func whoami() : async Principal {
    caller;
  };

  public query func http_request(request : HttpRequest) : async HttpResponse {
    if (request.method == "OPTIONS") {
      return empty(204);
    };

    if (request.method == "POST" and (isStorePath(request.url) or isExchangePath(request.url))) {
      return {
        status_code = 200;
        headers = commonHeaders("text/plain; charset=utf-8", "no-store");
        body = Text.encodeUtf8("");
        streaming_strategy = null;
        upgrade = ?true;
      };
    };

    if (request.method == "GET") {
      switch (assetResponse(request.url)) {
        case (?response) response;
        case null notFound();
      };
    } else {
      json(405, "{\"error\":\"Method not allowed\"}");
    };
  };

  public func http_request_update(request : HttpRequest) : async HttpResponse {
    if (request.method == "POST" and isStorePath(request.url)) {
      return await handleStore(request);
    };

    if (request.method == "POST" and isExchangePath(request.url)) {
      return handleExchange(request);
    };

    json(404, "{\"error\":\"Not found\"}");
  };

  func handleStore(request : HttpRequest) : async HttpResponse {
    cleanupExpiredCodes();

    switch (storeState(request.url)) {
      case null return json(400, "{\"error\":\"Missing state\"}");
      case (?state) {
        switch (Text.decodeUtf8(request.body)) {
          case null return json(400, "{\"error\":\"Delegation body must be UTF-8\"}");
          case (?delegation) {
            if (Text.size(state) < 32 or not Text.startsWith(Text.trim(delegation, #char ' '), #text "{")) {
              return json(400, "{\"error\":\"Invalid delegation store request\"}");
            };

            let entropy = await Random.blob();
            let code = hexEncode(Blob.toArray(entropy));
            codes.put(code, {
              state = state;
              delegation = delegation;
              expiresAt = Time.now() + codeTtlNs;
            });

            json(200, "{\"code\":\"" # code # "\",\"expiresInSeconds\":60}");
          };
        };
      };
    };
  };

  func handleExchange(request : HttpRequest) : HttpResponse {
    cleanupExpiredCodes();

    switch (exchangeStateAndCode(request.url)) {
      case null return json(400, "{\"error\":\"Missing state or code\"}");
      case (?(state, code)) {
        switch (codes.get(code)) {
          case null return json(404, "{\"error\":\"Unknown or already used code\"}");
          case (?record) {
            codes.delete(code);

            if (record.expiresAt <= Time.now()) {
              return json(410, "{\"error\":\"Code expired\"}");
            };

            if (record.state != state) {
              return json(400, "{\"error\":\"State mismatch\"}");
            };

            json(200, "{\"delegation\":" # record.delegation # "}");
          };
        };
      };
    };
  };

  func cleanupExpiredCodes() {
    let now = Time.now();
    let expired = Buffer.Buffer<Text>(0);

    for ((code, record) in codes.entries()) {
      if (record.expiresAt <= now) {
        expired.add(code);
      };
    };

    for (code in expired.vals()) {
      codes.delete(code);
    };
  };

  func normalizeDeviceLabel(name : Text) : Text {
    let trimmed = Text.trim(name, #char ' ');
    if (Text.size(trimmed) == 0) {
      "Mobile device";
    } else {
      trimmed;
    };
  };

  func assetResponse(url : Text) : ?HttpResponse {
    let path = normalizeAssetPath(takeBeforeQuery(url));

    for (asset in Assets.entries.vals()) {
      if (asset.path == path) {
        return ?{
          status_code = 200;
          headers = commonHeaders(asset.contentType, asset.cacheControl);
          body = Blob.fromArray(asset.body);
          streaming_strategy = null;
          upgrade = null;
        };
      };
    };

    null;
  };

  func normalizeAssetPath(path : Text) : Text {
    if (path == "/" or path == "/mobile-auth" or path == "/mobile-auth/") {
      return "/mobile-auth/index.html";
    };

    if (Text.startsWith(path, #text "/auth-callback")) {
      return "/auth-callback/index.html";
    };

    path;
  };

  func isStorePath(url : Text) : Bool {
    switch (storeState(url)) {
      case (?_) true;
      case null false;
    };
  };

  func isExchangePath(url : Text) : Bool {
    switch (exchangeStateAndCode(url)) {
      case (?_) true;
      case null false;
    };
  };

  func storeState(url : Text) : ?Text {
    let segments = pathSegments(url);
    if (segments.size() == 4 and segments[1] == "mobile-auth" and segments[2] == "store") {
      ?segments[3];
    } else {
      null;
    };
  };

  func exchangeStateAndCode(url : Text) : ?(Text, Text) {
    let segments = pathSegments(url);
    if (segments.size() == 5 and segments[1] == "mobile-auth" and segments[2] == "exchange") {
      ?(segments[3], segments[4]);
    } else {
      null;
    };
  };

  func pathSegments(url : Text) : [Text] {
    Iter.toArray(Text.split(takeBeforeQuery(url), #char '/'));
  };

  func takeBeforeQuery(url : Text) : Text {
    let parts = Text.split(url, #char '?');
    switch (parts.next()) {
      case (?path) path;
      case null url;
    };
  };

  func hexEncode(bytes : [Nat8]) : Text {
    Array.foldLeft<Nat8, Text>(bytes, "", func(acc, byte) {
      acc # hexByte(byte);
    });
  };

  func hexByte(byte : Nat8) : Text {
    let value = Nat8.toNat(byte);
    hexDigits[value / 16] # hexDigits[value % 16];
  };

  func json(status : Nat16, body : Text) : HttpResponse {
    {
      status_code = status;
      headers = commonHeaders("application/json; charset=utf-8", "no-store");
      body = Text.encodeUtf8(body);
      streaming_strategy = null;
      upgrade = null;
    };
  };

  func empty(status : Nat16) : HttpResponse {
    {
      status_code = status;
      headers = commonHeaders("text/plain; charset=utf-8", "no-store");
      body = Text.encodeUtf8("");
      streaming_strategy = null;
      upgrade = null;
    };
  };

  func notFound() : HttpResponse {
    json(404, "{\"error\":\"Not found\"}");
  };

  func commonHeaders(contentType : Text, cacheControl : Text) : [HeaderField] {
    [
      ("Content-Type", contentType),
      ("Cache-Control", cacheControl),
      ("Access-Control-Allow-Origin", "*"),
      ("Access-Control-Allow-Headers", "Content-Type"),
      ("Access-Control-Allow-Methods", "GET, POST, OPTIONS"),
      ("Cross-Origin-Opener-Policy", "same-origin-allow-popups"),
      ("Referrer-Policy", "no-referrer"),
      ("X-Content-Type-Options", "nosniff")
    ];
  };
};
