import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Buffer "mo:base/Buffer";
import HashMap "mo:base/HashMap";
import Iter "mo:base/Iter";
import Nat "mo:base/Nat";
import Nat8 "mo:base/Nat8";
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

  let codeTtlNs : Int = 60_000_000_000;
  let codes = HashMap.HashMap<Text, StoredCode>(16, Text.equal, Text.hash);
  let hexDigits : [Text] = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "a", "b", "c", "d", "e", "f"];

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
