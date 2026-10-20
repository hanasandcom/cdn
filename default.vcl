vcl 4.0;

backend default {
    .host = "127.0.0.1";
    .port = "8081";
}

sub vcl_recv {
    if (req.url ~ "^/health") { return (pass); }
    if (req.url ~ "^/(gallery|upload|login)(?:[/?#]|$)") { return (pass); }
    if (req.url ~ "^/files/[^/?#]+(?:[?#]|$)") { return (pass); }
    if (req.http.Upgrade ~ "(?i)websocket") {
        return (pipe);
    }

    if (req.method == "POST" || req.method == "PUT" || req.method == "HEAD" || req.method == "OPTIONS" || req.method == "DELETE") {
        return (pass);
    }

    if (req.url ~ "^/s(?:[/?#]|$)") {
        return (pass);
    }

    if (req.url ~ "^/api/(share|vm|words)(/.*)?$") {
        return (pass);
    }

    if (req.url ~ "^/api/files/user/") {
        return (pass);
    }

    if (req.url ~ "^/api/traffic/tps") {
        return (pass);
    }

    if (req.http.Authorization) {
        set req.http.X-Auth-Hash = req.http.Authorization;
    }

    if (req.url ~ "/([0-9a-fA-F-]{6,})") {
        set req.http.X-User-ID = regsub(req.url, ".*/([0-9a-fA-F-]{6,}).*", "\1");
    }

    return (hash);
}

sub vcl_pipe {
    if (req.http.Upgrade) {
        set bereq.http.Connection = "upgrade";
        set bereq.http.Upgrade = req.http.Upgrade;
    }
}

sub vcl_hash {
    hash_data(req.url);

    if (req.method == "POST") {
        if (req.http.Content-Length) {
            set req.http.X-Content-Length = req.http.Content-Length;
            hash_data(req.http.X-Content-Length);
        }
    }

    if (req.http.X-Auth-Hash) {
        hash_data(req.http.X-Auth-Hash);
    }

    if (req.http.X-User-ID) {
        hash_data(req.http.X-User-ID);
    }

    return (lookup);
}

sub vcl_backend_response {
    if (beresp.http.Cache-Control ~ "(?i)no-store") {
        set beresp.uncacheable = true;
        return (deliver);
    }

    set beresp.ttl = 1h;
    set beresp.http.Cache-Control = "hanasand-cache, max-age=3600";

    if (bereq.http.X-Auth-Hash && bereq.http.X-User-ID) {
        set beresp.ttl = 1m;
        set beresp.http.Cache-Control = "hanasand-cache, max-age=60";
    }

    return (deliver);
}

sub vcl_deliver {
    set resp.http.Via = "Varnish Hanasand Cache";

    if (obj.hits > 0) {
        set resp.http.X-Cache = "HIT:" + obj.hits;
    } else {
        set resp.http.X-Cache = "MISS";
    }

    return (deliver);
}
