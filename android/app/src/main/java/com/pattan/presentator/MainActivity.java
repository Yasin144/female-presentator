package com.pattan.presentator;

import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        bridge.setWebViewClient(new RecoveringWebViewClient());
    }

    private final class RecoveringWebViewClient extends BridgeWebViewClient {
        RecoveringWebViewClient() {
            super(bridge);
        }

        private boolean isExpiredTunnelRequest(WebResourceRequest request) {
            if (request == null || !request.isForMainFrame()) return false;
            Uri uri = request.getUrl();
            String host = uri == null ? "" : String.valueOf(uri.getHost());
            return host.endsWith(".trycloudflare.com") || host.endsWith(".loca.lt");
        }

        private void returnToConnector(WebView view) {
            String connector = bridge.getLocalUrl() + "/?staleMobileLink=1";
            view.post(() -> view.loadUrl(connector));
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (isExpiredTunnelRequest(request)) {
                returnToConnector(view);
                return;
            }
            super.onReceivedError(view, request, error);
        }

        @Override
        public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
            if (isExpiredTunnelRequest(request) && response != null && response.getStatusCode() >= 400) {
                returnToConnector(view);
                return;
            }
            super.onReceivedHttpError(view, request, response);
        }
    }
}
