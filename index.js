/// <reference types="@fastly/js-compute" />
import {CacheOverride} from "fastly:cache-override"
import {Logger} from "fastly:logger"
import {env} from "fastly:env"
import {allowDynamicBackends, enableDebugLogging} from "fastly:experimental"

const isDebugging = true
enableDebugLogging(isDebugging)
allowDynamicBackends(true)
let reqUrl
let waf_bypass
addEventListener("fetch", async (event) => event.respondWith(handleRequest(event)));

function mergeHeaders(backendResponseHeaders, event) {
    const xxxResponseHeaders = new Headers({
        "content-type": "text/html",
    })
    xxxResponseHeaders.set("x-xxx-url", event.request.url)
    xxxResponseHeaders.set("x-xxx-ip", event.client.address)

    backendResponseHeaders.forEach(function (value, name) {
        xxxResponseHeaders.append(name, value)
    })

    return xxxResponseHeaders
}

function enhanceRequestHeaders(headers, event) {
    if (waf_bypass !== "true") {
        headers.append("x-sigsci-host", selectBackend(reqUrl) + ".xxx.ch")
        headers.append("x-sigsci-backend", selectBackend(reqUrl))
        headers.append("x-sigsci-serviceid", env("FASTLY_SERVICE_ID"))
        headers.append("x-sigsci-ip-address", event.client.address)
    }
    return headers
}

/**
 * Selects the appropriate backend to call
 * @param reqUrl
 * @returns {Promise<string>}
 */
function selectBackend(reqUrl) {
    const backend = reqUrl.searchParams.get("backend")
    let origin
    switch (backend) {
        case "cdn-origin":
            origin = backend
            break
        case "ewaf":
            origin = backend
            break
        default:
            origin = "waf"
    }
    console.debug("origin: " + origin)
    return origin
}

async function selectCache(reqUrl) {
    const isPassed = reqUrl.searchParams.get("pass") !== null
    let cacheOverrideMode
    if (isPassed) {
        cacheOverrideMode = "pass"
    } else {
        cacheOverrideMode = "override"
    }
    return new CacheOverride(cacheOverrideMode, {
        ttl: 11,
    })
}

async function handleRequest(event) {
    const logger = new Logger("JavaScriptLog")
    logger.log(JSON.stringify(event))

    if (!["HEAD", "GET", "POST", "PUT"].includes(event.request.method)) {
        return new Response("METHOD_NOT_ALLOWED", {
            status: 405,
        })
    }
    const req = event.request

    reqUrl = new URL(req.url)
    waf_bypass = reqUrl.searchParams.get("waf_bypass")

    const backendRequest = new Request(event.request.url, {
        method: req.method,
        headers: enhanceRequestHeaders(req.headers, event),
    })
    console.warn(req.method)
    const cacheConfig = await selectCache(reqUrl)
    const backendResponse = await fetch(backendRequest, {
        backend: waf_bypass === "true" ? await selectBackend(reqUrl) : "ewaf",
        cacheOverride: cacheConfig,
    })
    return new Response(backendResponse.body, {
        status: backendResponse.status,
        headers: mergeHeaders(backendResponse.headers, event),
    })
}

// curl -v 'https://ce.xxx.ch/?pass=1&backend=cdn-origin' -H 'user-agent: nikto v1'
