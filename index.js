/*
CORS Anywhere as a Cloudflare Worker!
(c) 2019 by Zibri (www.zibri.org)
email: zibri AT zibri DOT org
https://github.com/Zibri/cloudflare-cors-anywhere
*/

const blacklistUrls = [];
const whitelistOrigins = [ ".*" ];

function isListedInWhitelist(uri, listing) {
    let isListed = false;
    if (typeof uri === "string") {
        listing.forEach((pattern) => {
            if (uri.match(pattern) !== null) {
                isListed = true;
            }
        });
    } else {
        isListed = true;
    }
    return isListed;
}

addEventListener("fetch", async event => {
    event.respondWith((async function() {
        try {
            const isPreflightRequest = (event.request.method === "OPTIONS");
            
            const originUrl = new URL(event.request.url);

            function setupCORSHeaders(headers) {
                headers.set("Access-Control-Allow-Origin", event.request.headers.get("Origin") || "*");
                if (isPreflightRequest) {
                    headers.set("Access-Control-Allow-Methods", event.request.headers.get("access-control-request-method"));
                    const requestedHeaders = event.request.headers.get("access-control-request-headers");

                    if (requestedHeaders) {
                        headers.set("Access-Control-Allow-Headers", requestedHeaders);
                    }

                    headers.delete("X-Content-Type-Options");
                }
                return headers;
            }

            let fetchUrl = originUrl.searchParams.get("url");
            if (!fetchUrl) {
                fetchUrl = originUrl.search.substr(1);
            }
            
            fetchUrl = fetchUrl.trim();

            if (!fetchUrl.match(/^https?:\/\//i) && !fetchUrl.startsWith("//")) {
                try {
                    const decoded = decodeURIComponent(fetchUrl);
                    if (decoded.match(/^https?:\/\//i) || decoded.startsWith("//")) {
                        fetchUrl = decoded;
                    } else {
                        const doubleDecoded = decodeURIComponent(decoded);
                        if (doubleDecoded.match(/^https?:\/\//i) || doubleDecoded.startsWith("//")) {
                            fetchUrl = doubleDecoded;
                        }
                    }
                } catch (e) {}
            }

            fetchUrl = fetchUrl.replace(/^(https?):\/+([^\/])/, '$1://$2');

            if (fetchUrl.startsWith("//")) {
                fetchUrl = "https:" + fetchUrl;
            } else if (fetchUrl.length > 0 && !fetchUrl.match(/^https?:\/\//i)) {
                fetchUrl = "https://" + fetchUrl;
            }

            const originHeader = event.request.headers.get("Origin");
            const connectingIp = event.request.headers.get("CF-Connecting-IP");

            if (fetchUrl.length > 0 && (!isListedInWhitelist(fetchUrl, blacklistUrls)) && (isListedInWhitelist(originHeader, whitelistOrigins))) {
                let customHeaders = event.request.headers.get("x-cors-headers");

                if (customHeaders !== null) {
                    try {
                        customHeaders = JSON.parse(customHeaders);
                    } catch (e) {}
                }

                const filteredHeaders = {};
                for (const [key, value] of event.request.headers.entries()) {
                    if (
                        (key.match("^origin") === null) &&
                        (key.match("eferer") === null) &&
                        (key.match("^cf-") === null) &&
                        (key.match("^x-forw") === null) &&
                        (key.match("^x-cors-headers") === null)
                    ) {
                        filteredHeaders[key] = value;
                    }
                }

                if (customHeaders !== null) {
                    Object.entries(customHeaders).forEach((entry) => (filteredHeaders[entry[0]] = entry[1]));
                }

                const newRequest = new Request(event.request, {
                    redirect: "manual",
                    headers: filteredHeaders
                });

                const response = await fetch(fetchUrl, newRequest);
                let responseHeaders = new Headers(response.headers);
                const exposedHeaders = [];
                const allResponseHeaders = {};
                for (const [key, value] of response.headers.entries()) {
                    exposedHeaders.push(key);
                    allResponseHeaders[key] = value;
                }
                exposedHeaders.push("cors-received-headers");
                responseHeaders = setupCORSHeaders(responseHeaders);

                responseHeaders.set("Access-Control-Expose-Headers", exposedHeaders.join(","));
                responseHeaders.set("cors-received-headers", JSON.stringify(allResponseHeaders));

                if ([301, 302, 303, 307, 308].includes(response.status)) {
                    const location = response.headers.get("location");
                    if (location) {
                        const resolvedLocation = new URL(location, fetchUrl).href;
                        responseHeaders.set("Location", originUrl.origin + "/?" + resolvedLocation);
                    }
                }

                const responseBody = isPreflightRequest ? null : response.body;

                const responseInit = {
                    headers: responseHeaders,
                    status: isPreflightRequest ? 200 : response.status,
                    statusText: isPreflightRequest ? "OK" : response.statusText
                };
                return new Response(responseBody, responseInit);

            } else {
                let responseHeaders = new Headers();
                responseHeaders = setupCORSHeaders(responseHeaders);

                let country = false;
                let colo = false;
                if (typeof event.request.cf !== "undefined") {
                    country = event.request.cf.country || false;
                    colo = event.request.cf.colo || false;
                }

                return new Response(
                    "CLOUDFLARE-CORS-ANYWHERE\n\n" +
                    "Source:\nhttps://github.com/Zibri/cloudflare-cors-anywhere\n\n" +
                    "Usage:\n" +
                    originUrl.origin + "/?uri\n\n" +
                    "Donate:\nhttps://paypal.me/Zibri/5\n\n" +
                    "Limits: 100,000 requests/day\n" +
                    "          1,000 requests/10 minutes\n\n" +
                    (originHeader !== null ? "Origin: " + originHeader + "\n" : "") +
                    "IP: " + connectingIp + "\n" +
                    (country ? "Country: " + country + "\n" : "") +
                    (colo ? "Datacenter: " + colo + "\n" : "") +
                    "\n" +
                    (customHeaders !== null ? "\nx-cors-headers: " + JSON.stringify(customHeaders) : ""),
                    {
                        status: 200,
                        headers: responseHeaders
                    }
                );
            }
        } catch (e) {
            return new Response(e.stack || e, { status: 500 });
        }
    })());
});
