var IO = require("io").IO,
    HashP = require("hashp").HashP;

var engine = exports;

engine.connect = function HTTPClient_engine_connect (tx) {
    if (tx._isConnected) return;
    
    var con = tx._connection = java.net.HttpURLConnection(
        new java.net.URL(tx.url).openConnection()
    );
    con.setRequestMethod(tx.method.toUpperCase());
    
    HashP.forEach(tx.headers, function (h, v) {
        con.setRequestProperty(h, v);
    });
    
    var cl = HashP.get(tx.headers, "Content-Length") || 0;
    if (cl > 0) {
        con.setDoOutput(true);
        var os = null;
        try {
            os = con.getOutputStream();
        } catch (ex) {}
        if (os) {
            var writer = new IO(null, con.getOutputStream());
            tx.body.forEach(function (piece) {
                writer.write(piece);
            });
            writer.close();
        }
    }
    
    try {
        con.connect();
    } catch (ex) {
        // It would be nice to do something clever and special here,
        // but I'm not feeling it at the moment.
        ex.message = [
            "Could not connect to "+tx.url+". Probably a bad hostname.",
            ex.message
        ].join("\n");
        throw ex;
    }
    tx._isConnected = true;
    var resp = tx._response = {status:200, headers:{}, body:[]};
    
    // Call this now to trigger the fetch asynchronously.
    // This way, if you set up multiple HTTPClients, and then call connect()
    // on all of them, you'll only wait as long as the slowest one, since
    // the streams will start filling up right away.
    
    // This feels and looks like a kludge, and I don't like it any more
    // than you do. Until you don't call getHeaderFields (or getContent, or something)
    // then the java.net.HttpURLConnection object will just connect to
    // the server on port 80 and patiently wait for you to want something.
    // Since the body is typically the slow bit, waiting for headers is not so bad.
    con.getHeaderFields();
};

engine.read = function HTTPClient_engine_read (tx) {
    if (!tx._isConnected) engine.connect(tx);
    
    var con = tx._connection,
        resp = tx._response;
    
    // now pull everything out.
    var fields = con.getHeaderFields();
    var fieldKeys = fields.keySet().toArray();
    for (var i = 0, l = fieldKeys.length; i < l; i ++ ) {
        var fieldValue = fields.get(fieldKeys[i]).toArray().join('');
        var fieldName = fieldKeys[i];
        if (fieldName === null) {
            // Something like: HTTP/1.1 200 OK
            HashP.set(resp, "status", +(/HTTP\/1\.[01] ([0-9]{3})/.exec(fieldValue)[1]));
            // fieldName = "Status";
            resp.statusText = fieldValue;
            continue;
        }
        HashP.set(resp.headers, fieldName, fieldValue);
    }

    // TODO: Restructure using non-blocking IO to support asynchronous interactions.
    // In that case, you could just have a callback that gets each bytestring.
    var is = null;
    try {
        var is = con.getInputStream();
    } catch (ex) {
        return resp;
    }
    
    // TODO: Should the input stream be rewindable?  Perhaps it doesn't make sense to
    // close it after the first pass through the data.
    var reader = new IO(con.getInputStream(), null);
    resp.body = {forEach : function (block) {
        var buflen = 1024;
        for (
            var bytes = reader.read(buflen);
            bytes.length > 0;
            bytes = reader.read(buflen)
        ) block(bytes);
    }};
    
    return resp;
};
