use serde::{Deserialize, Serialize};

pub const SOURCE_BING: &str = "bing";
pub const SOURCE_WALLHAVEN: &str = "wallhaven";
pub const SOURCE_PIXABAY: &str = "pixabay";
pub const SOURCE_COVERR: &str = "coverr";


pub fn requires_api_key(source: &str) -> bool {
    source == SOURCE_PIXABAY
}

pub fn effective_query<'a>(query: &'a str, cfg: &'a crate::config::DiscoverSourceCfg) -> &'a str {
    let q = query.trim();
    if q.is_empty() {
        cfg.default_query.trim()
    } else {
        q
    }
}

const MAX_THUMB_BYTES: usize = 4 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiscoverItem {
    pub id: String,
    pub title: String,
    pub url: String,
    pub thumb: String,
    pub width: u32,
    pub height: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration: Option<u32>,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiscoverPage {
    pub items: Vec<DiscoverItem>,
    pub last_page: Option<u32>,
}

pub fn bing_feed_url() -> String {
    "https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=8".to_string()
}

pub fn bing_full_url(urlbase: &str) -> Result<String, String> {
    if !urlbase.starts_with("/th?id=OHR.") || urlbase.contains("..") || urlbase.contains('&') {
        return Err(format!("unexpected Bing image reference: {urlbase}"));
    }
    Ok(format!("https://www.bing.com{urlbase}_1920x1080.jpg"))
}

pub fn bing_thumb_url(urlbase: &str) -> Result<String, String> {
    if !urlbase.starts_with("/th?id=OHR.") || urlbase.contains("..") || urlbase.contains('&') {
        return Err(format!("unexpected Bing image reference: {urlbase}"));
    }
    Ok(format!("https://www.bing.com{urlbase}_640x360.jpg"))
}

#[derive(Deserialize)]
struct BingFeed {
    #[serde(default)]
    images: Vec<BingImage>,
}

#[derive(Deserialize)]
struct BingImage {
    #[serde(default)]
    urlbase: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    copyright: String,
}

pub fn parse_bing(json: &str) -> Result<DiscoverPage, String> {
    let feed: BingFeed =
        serde_json::from_str(json).map_err(|e| format!("Bing response unreadable: {e}"))?;
    let mut items = Vec::new();
    for img in feed.images {
        if img.urlbase.is_empty() {
            continue;
        }
        let url = bing_full_url(&img.urlbase)?;
        let thumb = bing_thumb_url(&img.urlbase)?;
        let title = if img.title.trim().is_empty() {
            img.copyright
        } else {
            img.title
        };
        items.push(DiscoverItem {
            id: img.urlbase.clone(),
            title,
            url,
            thumb,
            width: 1920,
            height: 1080,
            duration: None,
            source: SOURCE_BING.to_string(),
        });
    }
    if items.is_empty() {
        return Err("Bing returned no images".into());
    }
    Ok(DiscoverPage {
        items,
        last_page: None,
    })
}


pub fn wallhaven_search_url(query: &str, page: u32) -> String {
    let mut url = url::Url::parse("https://wallhaven.cc/api/v1/search")
        .expect("the Wallhaven base URL is a valid URL");
    {
        let mut pairs = url.query_pairs_mut();
        let q = query.trim();
        if !q.is_empty() {
            pairs.append_pair("q", q);
        }
        pairs.append_pair("atleast", "1920x1080");
        pairs.append_pair("purity", "sfw");
        if page > 1 {
            pairs.append_pair("page", &page.to_string());
        }
    }
    url.to_string()
}

#[derive(Deserialize)]
struct WallhavenResponse {
    #[serde(default)]
    data: Vec<WallhavenImage>,
    #[serde(default)]
    meta: Option<WallhavenMeta>,
}

#[derive(Deserialize)]
struct WallhavenMeta {
    #[serde(default)]
    current_page: Option<u32>,
    #[serde(default)]
    last_page: Option<u32>,
}

#[derive(Deserialize)]
struct WallhavenImage {
    #[serde(default)]
    id: String,
    #[serde(default)]
    path: String,
    #[serde(default)]
    resolution: String,
    #[serde(default)]
    thumbs: Option<WallhavenThumbs>,
}

#[derive(Deserialize)]
struct WallhavenThumbs {
    #[serde(default)]
    large: Option<String>,
    #[serde(default)]
    small: Option<String>,
}

fn parse_resolution(res: &str) -> (u32, u32) {
    match res.split_once('x') {
        Some((w, h)) => (
            w.trim().parse().unwrap_or(0),
            h.trim().parse().unwrap_or(0),
        ),
        None => (0, 0),
    }
}

pub fn parse_wallhaven(json: &str) -> Result<DiscoverPage, String> {
    let resp: WallhavenResponse =
        serde_json::from_str(json).map_err(|e| format!("Wallhaven response unreadable: {e}"))?;
    let items = resp
        .data
        .into_iter()
        .filter(|img| !img.id.is_empty() && img.path.starts_with("https://"))
        .map(|img| {
            let thumb = img
                .thumbs
                .as_ref()
                .and_then(|t| t.large.clone())
                .or_else(|| img.thumbs.as_ref().and_then(|t| t.small.clone()))
                .unwrap_or_else(|| img.path.clone());
            let (width, height) = parse_resolution(&img.resolution);
            DiscoverItem {
                id: img.id.clone(),
                title: if img.resolution.is_empty() {
                    img.id.clone()
                } else {
                    img.resolution.clone()
                },
                url: img.path,
                thumb,
                width,
                height,
                duration: None,
                source: SOURCE_WALLHAVEN.to_string(),
            }
        })
        .collect::<Vec<_>>();
    Ok(DiscoverPage {
        items,
        last_page: resp.meta.and_then(|m| m.last_page),
    })
}

pub fn pixabay_search_url(query: &str, page: u32, api_key: &str) -> Result<String, String> {
    let key = api_key.trim();
    if key.is_empty() {
        return Err("Pixabay needs an API key (free at pixabay.com/api)".into());
    }
    let mut url = url::Url::parse("https://pixabay.com/api/videos/")
        .expect("the Pixabay base URL is a valid URL");
    {
        let mut pairs = url.query_pairs_mut();
        pairs.append_pair("key", key);
        let q = query.trim();
        if !q.is_empty() {
            pairs.append_pair("q", q);
        }
        pairs.append_pair("per_page", "24");
        pairs.append_pair("safesearch", "true");
        pairs.append_pair("min_width", "1920");
        pairs.append_pair("order", "popular");
        if page > 1 {
            pairs.append_pair("page", &page.to_string());
        }
    }
    Ok(url.to_string())
}

#[derive(Deserialize)]
struct PixabayResponse {
    #[serde(rename = "totalHits", default)]
    total_hits: u64,
    #[serde(default)]
    hits: Vec<PixabayHit>,
}

#[derive(Deserialize)]
struct PixabayHit {
    #[serde(default)]
    id: u64,
    #[serde(default)]
    tags: String,
    #[serde(default)]
    duration: Option<u64>,
    #[serde(default)]
    videos: Option<PixabayVideos>,
}

#[derive(Deserialize)]
struct PixabayVideos {
    #[serde(default)]
    large: Option<PixabayRendition>,
    #[serde(default)]
    medium: Option<PixabayRendition>,
    #[serde(default)]
    small: Option<PixabayRendition>,
    #[serde(default)]
    tiny: Option<PixabayRendition>,
}

#[derive(Deserialize)]
struct PixabayRendition {
    #[serde(default)]
    url: String,
    #[serde(default)]
    width: u32,
    #[serde(default)]
    height: u32,
    #[serde(default)]
    size: u64,
    #[serde(default)]
    thumbnail: String,
}

fn pick_pixabay_rendition(v: &PixabayVideos) -> Option<&PixabayRendition> {
    const DOWNLOAD_CAP: u64 = 120 * 1024 * 1024;
    let usable = |r: &PixabayRendition| !r.url.is_empty();
    if v.large.as_ref().is_some_and(|r| usable(r) && r.size > 0 && r.size <= DOWNLOAD_CAP) {
        return v.large.as_ref();
    }
    [v.medium.as_ref(), v.small.as_ref(), v.tiny.as_ref(), v.large.as_ref()]
        .into_iter()
        .flatten()
        .find(|r| usable(r))
}

fn pick_pixabay_thumb(v: &PixabayVideos) -> Option<&str> {
    [v.medium.as_ref(), v.small.as_ref(), v.large.as_ref(), v.tiny.as_ref()]
        .into_iter()
        .flatten()
        .map(|r| r.thumbnail.as_str())
        .find(|t| !t.is_empty())
}

pub fn parse_pixabay(json: &str) -> Result<DiscoverPage, String> {
    let resp: PixabayResponse =
        serde_json::from_str(json).map_err(|e| format!("Pixabay response unreadable: {e}"))?;
    let mut items = Vec::new();
    for hit in resp.hits {
        let Some(videos) = hit.videos.as_ref() else {
            continue;
        };
        let Some(rendition) = pick_pixabay_rendition(videos) else {
            continue;
        };
        let thumb = pick_pixabay_thumb(videos)
            .map(str::to_string)
            .unwrap_or_else(|| rendition.url.clone());
        let title = if hit.tags.trim().is_empty() {
            format!("Pixabay {}", hit.id)
        } else {
            hit.tags.trim().to_string()
        };
        items.push(DiscoverItem {
            id: hit.id.to_string(),
            title,
            url: rendition.url.clone(),
            thumb,
            width: rendition.width,
            height: rendition.height,
            duration: hit.duration.map(|d| d.min(u32::MAX as u64) as u32),
            source: SOURCE_PIXABAY.to_string(),
        });
    }
    let per_page = 24u64;
    let last_page = (resp.total_hits.div_ceil(per_page))
        .max(1)
        .min(u32::MAX as u64) as u32;
    Ok(DiscoverPage {
        items,
        last_page: Some(last_page),
    })
}


pub fn coverr_search_url(query: &str, page: u32) -> String {
    let mut url = url::Url::parse("https://coverr.co/api/videos")
        .expect("the Coverr base URL is a valid URL");
    {
        let mut pairs = url.query_pairs_mut();
        let q = query.trim();
        if !q.is_empty() {
            pairs.append_pair("query", q);
        }

        pairs.append_pair("page", &(page.max(1) - 1).to_string());
        pairs.append_pair("page_size", "24");
    }
    url.to_string()
}

pub fn coverr_video_url(base_filename: &str, max_width: u32) -> Result<String, String> {
    if base_filename.is_empty()
        || !base_filename
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(format!("unexpected Coverr file name: {base_filename}"));
    }
    let rendition = if max_width >= 1920 { "1080p" } else { "720p" };
    Ok(format!(
        "https://cdn.coverr.co/videos/{base_filename}/{rendition}.mp4"
    ))
}

#[derive(Deserialize)]
struct CoverrResponse {
    #[serde(default)]
    pages: u32,
    #[serde(default)]
    hits: Vec<CoverrHit>,
}

#[derive(Deserialize)]
struct CoverrHit {
    #[serde(default)]
    id: String,
    #[serde(default)]
    base_filename: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    duration: Option<String>,
    #[serde(default)]
    max_width: Option<u32>,
    #[serde(default)]
    max_height: Option<u32>,
    #[serde(default)]
    is_premium: Option<bool>,
    #[serde(default)]
    state: Option<String>,
    #[serde(default)]
    thumbnail: Option<String>,
}

pub fn parse_coverr(json: &str) -> Result<DiscoverPage, String> {
    let resp: CoverrResponse =
        serde_json::from_str(json).map_err(|e| format!("Coverr response unreadable: {e}"))?;
    let mut items = Vec::new();
    for hit in resp.hits {
        if hit.is_premium.unwrap_or(false) {
            continue;
        }
        if hit.state.as_deref().unwrap_or("published") != "published" {
            continue;
        }
        if hit.base_filename.is_empty() {
            continue;
        }
        let url = coverr_video_url(&hit.base_filename, hit.max_width.unwrap_or(1920))?;
        let thumb = hit
            .thumbnail
            .filter(|t| !t.is_empty())
            .unwrap_or_else(|| format!("https://cdn.coverr.co/videos/{}/thumbnail?width=640", hit.base_filename));
        let duration = hit
            .duration
            .as_deref()
            .and_then(|d| d.parse::<f64>().ok())
            .map(|d| d.round().clamp(0.0, u32::MAX as f64) as u32);
        let title = if hit.title.trim().is_empty() {
            hit.base_filename.clone()
        } else {
            hit.title.trim().to_string()
        };
        items.push(DiscoverItem {
            id: if hit.id.is_empty() {
                hit.base_filename.clone()
            } else {
                hit.id.clone()
            },
            title,
            url,
            thumb,
            width: hit.max_width.unwrap_or(0),
            height: hit.max_height.unwrap_or(0),
            duration,
            source: SOURCE_COVERR.to_string(),
        });
    }
    Ok(DiscoverPage {
        items,
        last_page: (resp.pages >= 1).then_some(resp.pages),
    })
}


fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .user_agent(format!(
            "LumenDeck/{} (+https://github.com/GabrielCrackPro/lumendeck)",
            env!("CARGO_PKG_VERSION")
        ))
        .build()
        .map_err(crate::error::err_str)
}

async fn get_text(url: &str) -> Result<String, String> {
    let resp = http_client()?
        .get(url)
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status().as_u16()));
    }
    resp.text().await.map_err(|e| format!("read failed: {e}"))
}

pub async fn list(
    source: &str,
    query: &str,
    page: u32,
    cfg: &crate::config::DiscoverConfig,
) -> Result<DiscoverPage, String> {
    if !matches!(
        source,
        SOURCE_BING | SOURCE_WALLHAVEN | SOURCE_PIXABAY | SOURCE_COVERR
    ) {
        return Err(format!("unknown source: {source}"));
    }
    let stored = cfg
        .sources
        .iter()
        .find(|s| s.id == source)
        .cloned()
        .unwrap_or_else(|| crate::config::DiscoverSourceCfg::builtin(source));
    if !stored.enabled {
        return Err(format!("source disabled: {source}"));
    }
    let query = effective_query(query, &stored);
    match source {
        SOURCE_BING => {
            let body = get_text(&bing_feed_url()).await?;
            parse_bing(&body)
        }
        SOURCE_WALLHAVEN => {
            let body = get_text(&wallhaven_search_url(query, page.max(1))).await?;
            parse_wallhaven(&body)
        }
        SOURCE_PIXABAY => {
            let url = pixabay_search_url(query, page.max(1), &stored.api_key)?;
            let body = get_text(&url).await?;
            parse_pixabay(&body)
        }
        SOURCE_COVERR => {
            let body = get_text(&coverr_search_url(query, page)).await?;
            parse_coverr(&body)
        }
        other => Err(format!("unknown source: {other}")),
    }
}

pub fn is_allowed_host(host: &str) -> bool {
    let host = host.to_ascii_lowercase();
    host == "bing.com"
        || host.ends_with(".bing.com")
        || host == "wallhaven.cc"
        || host.ends_with(".wallhaven.cc")
        || host == "pixabay.com"
        || host.ends_with(".pixabay.com")
        || host == "coverr.co"
        || host.ends_with(".coverr.co")
}

pub async fn thumb_data_url(url: &str) -> Result<String, String> {
    let parsed = url
        .parse::<url::Url>()
        .map_err(|_| "not a valid URL".to_string())?;
    if parsed.scheme() != "https" && parsed.scheme() != "http" {
        return Err("only http(s) thumbnails are fetched".into());
    }
    let host = parsed.host_str().ok_or("URL has no host")?;
    if !is_allowed_host(host) {
        return Err(format!("host not allowed: {host}"));
    }

    let resp = http_client()?
        .get(url)
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status().as_u16()));
    }
    let mime = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    if !mime.starts_with("image/") {
        return Err(format!("not an image: {mime}"));
    }

    let mut bytes: Vec<u8> = Vec::new();
    let mut stream = resp;
    while let Some(chunk) = stream
        .chunk()
        .await
        .map_err(|e| format!("read failed: {e}"))?
    {
        bytes.extend_from_slice(&chunk);
        if bytes.len() > MAX_THUMB_BYTES {
            return Err("thumbnail too large".into());
        }
    }
    if bytes.is_empty() {
        return Err("empty thumbnail".into());
    }

    use base64::Engine as _;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:{mime};base64,{b64}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::runtime::Runtime;

    const BING_LIVE: &str = r#"{"images":[{"startdate":"20261008","url":"/th?id=OHR.IlesSanguinaires_ES-ES4266688471_1920x1080.jpg&rf=LaDigue_1920x1080.jpg&pid=hp","urlbase":"/th?id=OHR.IlesSanguinaires_ES-ES4266688471","copyright":"Vista de las islas Sanguinarias (© Francesco Riccardo Iacomino/Getty Images)","title":"Los centinelas de Córcega"},{"startdate":"20261007","urlbase":"/th?id=OHR.MayotteOctopus_ES-ES3892391318","copyright":"Pulpo en postura defensiva","title":"Ahora me ves, ahora no"}]}"#;

    const WALLHAVEN_LIVE: &str = r#"{"data":[{"id":"xek223","url":"https://wallhaven.cc/w/xek223","dimension_x":3840,"dimension_y":2050,"resolution":"3840x2050","path":"https://w.wallhaven.cc/full/xe/wallhaven-xek223.jpg","thumbs":{"large":"https://th.wallhaven.cc/lg/xe/xek223.jpg","small":"https://th.wallhaven.cc/small/xe/xek223.jpg"}},{"id":"5ypjo5","resolution":"3840x2160","path":"https://w.wallhaven.cc/full/5y/wallhaven-5ypjo5.png","thumbs":{"small":"https://th.wallhaven.cc/small/5y/5ypjo5.jpg"}}],"meta":{"current_page":1,"last_page":42}}"#;

    #[test]
    fn bing_feed_parses_live_json() {
        let page = parse_bing(BING_LIVE).expect("live-shaped feed must parse");
        assert_eq!(page.items.len(), 2);
        assert_eq!(page.last_page, None, "Bing has no paging");
        let first = &page.items[0];
        assert_eq!(first.title, "Los centinelas de Córcega");
        assert_eq!(
            first.url,
            "https://www.bing.com/th?id=OHR.IlesSanguinaires_ES-ES4266688471_1920x1080.jpg"
        );
        assert_eq!(
            first.thumb,
            "https://www.bing.com/th?id=OHR.IlesSanguinaires_ES-ES4266688471_640x360.jpg"
        );
        assert_eq!((first.width, first.height), (1920, 1080));
        assert_eq!(first.source, "bing");
        assert_eq!(page.items[1].title, "Ahora me ves, ahora no");
    }

    #[test]
    fn bing_falls_back_to_copyright_when_the_title_is_missing() {
        let json = r#"{"images":[{"urlbase":"/th?id=OHR.Solo_copy","copyright":"Only a credit","title":""}]}"#;
        let page = parse_bing(json).unwrap();
        assert_eq!(page.items[0].title, "Only a credit");
    }

    #[test]
    fn bing_rejects_a_urlbase_that_would_escape_the_host() {
        for bad in ["/th?id=OHR.../../etc", "/evil?id=x", "https://evil/x", ""] {
            assert!(
                bing_full_url(bad).is_err(),
                "{bad} should not produce a URL"
            );
        }
    }

    #[test]
    fn wallhaven_search_url_encodes_the_query_and_pins_safety() {
        let url = wallhaven_search_url("dark forest", 1);
        assert!(url.contains("q=dark+forest"), "{url}");
        assert!(url.contains("atleast=1920x1080"), "{url}");
        assert!(url.contains("purity=sfw"), "{url}");
        assert!(!url.contains("page="), "page 1 stays implicit: {url}");

        let page3 = wallhaven_search_url("", 3);
        assert!(page3.contains("page=3"), "{page3}");
        assert!(!page3.contains("q="), "no empty q parameter: {page3}");
    }

    #[test]
    fn wallhaven_parses_live_json() {
        let page = parse_wallhaven(WALLHAVEN_LIVE).expect("live-shaped response must parse");
        assert_eq!(page.last_page, Some(42));
        assert_eq!(page.items.len(), 2);
        let first = &page.items[0];
        assert_eq!(first.id, "xek223");
        assert_eq!(first.title, "3840x2050");
        assert_eq!(first.url, "https://w.wallhaven.cc/full/xe/wallhaven-xek223.jpg");
        assert_eq!(first.thumb, "https://th.wallhaven.cc/lg/xe/xek223.jpg");
        assert_eq!((first.width, first.height), (3840, 2050));
        assert_eq!(first.source, "wallhaven");
    }

    #[test]
    fn wallhaven_items_without_a_large_thumb_use_the_small_one() {
        let page = parse_wallhaven(WALLHAVEN_LIVE).unwrap();
        assert_eq!(
            page.items[1].thumb,
            "https://th.wallhaven.cc/small/5y/5ypjo5.jpg"
        );
    }

    #[test]
    fn wallhaven_skips_entries_with_an_unsafe_path() {
        let json = r#"{"data":[{"id":"x","path":"file:///C:/secret.png"},{"id":"ok","path":"https://w.wallhaven.cc/full/ok/ok.png","resolution":"1920x1080"}],"meta":null}"#;
        let page = parse_wallhaven(json).unwrap();
        assert_eq!(page.items.len(), 1);
        assert_eq!(page.items[0].id, "ok");
    }

    #[test]
    fn thumbnail_hosts_are_an_allowlist_not_a_free_proxy() {
        for ok in [
            "th.wallhaven.cc",
            "wallhaven.cc",
            "www.bing.com",
            "bing.com",
            "cdn.pixabay.com",
            "pixabay.com",
            "cdn.coverr.co",
            "coverr.co",
        ] {
            assert!(is_allowed_host(ok), "{ok} should be allowed");
        }
        for bad in [
            "evil.com",
            "wallhaven.cc.evil.com",
            "notwallhaven.cc",
            "pixabay.com.evil.com",
            "notcoverr.co",
            "192.168.1.1",
            "localhost",
        ] {
            assert!(!is_allowed_host(bad), "{bad} must be refused");
        }
    }

    #[test]
    fn an_unknown_source_is_an_error_not_a_fetch() {
        let rt = Runtime::new().unwrap();
        let cfg = crate::config::DiscoverConfig::default();
        let err = rt.block_on(list("gopher", "", 1, &cfg)).unwrap_err();
        assert!(err.contains("unknown source"), "{err}");
    }

    #[test]
    fn a_disabled_source_is_refused_before_any_request() {
        let rt = Runtime::new().unwrap();
        let mut cfg = crate::config::DiscoverConfig::default();
        cfg.sources.iter_mut().find(|s| s.id == "coverr").unwrap().enabled = false;
        let err = rt.block_on(list("coverr", "", 1, &cfg)).unwrap_err();
        assert!(err.contains("disabled"), "{err}");
    }

    #[test]
    fn pixabay_without_a_key_fails_before_any_request() {
        let rt = Runtime::new().unwrap();
        let cfg = crate::config::DiscoverConfig::default();
        let err = rt.block_on(list("pixabay", "", 1, &cfg)).unwrap_err();
        assert!(err.to_lowercase().contains("api key"), "{err}");
    }

    #[test]
    fn a_config_that_predates_a_source_still_queries_it() {
        let rt = Runtime::new().unwrap();
        let cfg = crate::config::DiscoverConfig {
            sources: vec![crate::config::DiscoverSourceCfg::builtin("bing")],
        };
        let err = rt.block_on(list("gopher", "", 1, &cfg)).unwrap_err();
        assert!(err.contains("unknown source"), "{err}");
        let err = rt.block_on(list("pixabay", "", 1, &cfg)).unwrap_err();
        assert!(err.to_lowercase().contains("api key"), "{err}");
    }

    #[test]
    fn the_effective_query_prefers_the_box_then_the_default() {
        let cfg = crate::config::DiscoverSourceCfg {
            id: "coverr".into(),
            enabled: true,
            api_key: String::new(),
            default_query: " ocean ".into(),
        };
        assert_eq!(effective_query("forest", &cfg), "forest");
        assert_eq!(effective_query("   ", &cfg), "ocean");
        assert_eq!(effective_query("", &cfg), "ocean");
    }

    #[test]
    fn a_non_https_wallhaven_path_is_rejected_before_download() {
        let json = r#"{"data":[{"id":"x","path":"http://plain.example/x.jpg"}],"meta":null}"#;
        let page = parse_wallhaven(json).unwrap();
        assert_eq!(page.items.len(), 0, "http path must be skipped");
    }

    const PIXABAY_LIVE: &str = r#"{"total":42,"totalHits":42,"hits":[{"id":125,"pageURL":"https://pixabay.com/videos/id-125/","type":"film","tags":"flowers, yellow, blossom","duration":12,"videos":{"large":{"url":"https://cdn.pixabay.com/video/2015/08/08/125-135736646_large.mp4","width":1920,"height":1080,"size":6615235,"thumbnail":"https://cdn.pixabay.com/video/2015/08/08/125-135736646_large.jpg"},"medium":{"url":"https://cdn.pixabay.com/video/2015/08/08/125-135736646_medium.mp4","width":1280,"height":720,"size":3562083,"thumbnail":"https://cdn.pixabay.com/video/2015/08/08/125-135736646_medium.jpg"},"small":{"url":"https://cdn.pixabay.com/video/2015/08/08/125-135736646_small.mp4","width":640,"height":360,"size":1030736,"thumbnail":"https://cdn.pixabay.com/video/2015/08/08/125-135736646_small.jpg"},"tiny":{"url":"https://cdn.pixabay.com/video/2015/08/08/125-135736646_tiny.mp4","width":480,"height":270,"size":426799,"thumbnail":"https://cdn.pixabay.com/video/2015/08/08/125-135736646_tiny.jpg"}}}] }"#;

    const COVERR_LIVE: &str = r#"{"pages":42,"hits":[{"id":"zlfEmfALLV","base_filename":"coverr-premium-woman-traces-on-sand","title":"Woman Drawing Letters in the Sand at the Beach","duration":"9.120000","max_width":3840,"max_height":2160,"is_premium":true,"state":"published","thumbnail":"https://cdn.coverr.co/videos/coverr-premium-woman-traces-on-sand/thumbnail?width=640"},{"id":"9s8kkmjQPW","base_filename":"coverr-flickering-christmas-lights-5452","title":"Flickering Christmas lights","duration":"13.055000","max_width":1920,"max_height":1080,"is_premium":false,"state":"published","thumbnail":"https://cdn.coverr.co/videos/coverr-flickering-christmas-lights-5452/thumbnail?width=640"},{"id":"draftId","base_filename":"coverr-unpublished-clip","title":"Unpublished clip","duration":"5","max_width":1920,"max_height":1080,"is_premium":false,"state":"draft"},{"id":"noTitle","base_filename":"coverr-untitled-clip","duration":"3","max_width":1280,"max_height":720,"is_premium":false,"state":"published"}] }"#;

    #[test]
    fn pixabay_search_url_encodes_and_pins_the_video_params() {
        let err = pixabay_search_url("forest", 1, "   ").unwrap_err();
        assert!(err.to_lowercase().contains("api key"), "{err}");

        let url = pixabay_search_url("dark forest", 1, " KEY123 ").unwrap();
        assert!(url.starts_with("https://pixabay.com/api/videos/?"), "{url}");
        assert!(url.contains("key=KEY123"), "{url}");
        assert!(url.contains("q=dark+forest"), "{url}");
        assert!(url.contains("per_page=24"), "{url}");
        assert!(url.contains("safesearch=true"), "{url}");
        assert!(url.contains("min_width=1920"), "{url}");
        assert!(url.contains("order=popular"), "{url}");
        assert!(
            !url.split('&').any(|p| p.starts_with("page=")),
            "page 1 stays implicit: {url}"
        );

        let page3 = pixabay_search_url("", 3, "KEY123").unwrap();
        assert!(page3.contains("page=3"), "{page3}");
        assert!(!page3.contains("q="), "empty q omitted: {page3}");
    }

    #[test]
    fn pixabay_parses_the_documented_response() {
        let page = parse_pixabay(PIXABAY_LIVE).expect("documented response must parse");
        assert_eq!(page.last_page, Some(2), "42 hits / 24 per page = 2");
        assert_eq!(page.items.len(), 1);
        let item = &page.items[0];
        assert_eq!(item.id, "125");
        assert_eq!(item.title, "flowers, yellow, blossom");
        assert_eq!(item.duration, Some(12));
        assert_eq!(item.source, "pixabay");
        // under the download cap, so the 1080p rendition wins
        assert_eq!(
            item.url,
            "https://cdn.pixabay.com/video/2015/08/08/125-135736646_large.mp4"
        );
        assert_eq!(
            item.thumb,
            "https://cdn.pixabay.com/video/2015/08/08/125-135736646_medium.jpg"
        );
        assert_eq!((item.width, item.height), (1920, 1080));
    }

    #[test]
    fn pixabay_downgrades_to_a_smaller_rendition_over_the_cap() {
        let json = PIXABAY_LIVE.replace("\"size\":6615235", "\"size\":314572800");
        let page = parse_pixabay(&json).unwrap();
        assert_eq!(
            page.items[0].url,
            "https://cdn.pixabay.com/video/2015/08/08/125-135736646_medium.mp4"
        );
        assert_eq!((page.items[0].width, page.items[0].height), (1280, 720));
    }

    #[test]
    fn pixabay_skips_hits_without_any_playable_rendition() {
        let json = r#"{"totalHits":2,"hits":[{"id":1,"videos":null},{"id":2,"tags":"no url","videos":{"large":{"url":"","width":0,"height":0,"size":0,"thumbnail":""},"medium":{"url":"","width":0,"height":0,"size":0,"thumbnail":""}}}] }"#;
        let page = parse_pixabay(json).unwrap();
        assert!(page.items.is_empty(), "unplayable hits must be dropped");
    }

    #[test]
    fn coverr_search_url_maps_one_based_pages_to_zero_based() {
        let p1 = coverr_search_url("", 1);
        assert!(p1.starts_with("https://coverr.co/api/videos?"), "{p1}");
        assert!(p1.contains("page=0"), "{p1}");
        assert!(p1.contains("page_size=24"), "{p1}");
        assert!(!p1.contains("query="), "empty query omitted: {p1}");

        let p3 = coverr_search_url("dark forest", 3);
        assert!(p3.contains("page=2"), "{p3}");
        assert!(p3.contains("query=dark+forest"), "{p3}");
    }

    #[test]
    fn coverr_video_url_picks_a_rendition_and_checks_the_file_name() {
        assert_eq!(
            coverr_video_url("coverr-clip-1", 3840).unwrap(),
            "https://cdn.coverr.co/videos/coverr-clip-1/1080p.mp4"
        );
        assert_eq!(
            coverr_video_url("coverr-clip-1", 1920).unwrap(),
            "https://cdn.coverr.co/videos/coverr-clip-1/1080p.mp4"
        );
        assert_eq!(
            coverr_video_url("coverr-clip-1", 1280).unwrap(),
            "https://cdn.coverr.co/videos/coverr-clip-1/720p.mp4"
        );
        for bad in ["", "../secrets", "a/b", "a b", "a\"b", "clip.mp4", "clip?x=1"] {
            assert!(coverr_video_url(bad, 1920).is_err(), "{bad} should be refused");
        }
    }

    #[test]
    fn coverr_parses_a_live_listing() {
        let page = parse_coverr(COVERR_LIVE).expect("live-shaped listing must parse");
        assert_eq!(page.last_page, Some(42));
        assert_eq!(page.items.len(), 2, "premium and draft hits are dropped");

        let first = &page.items[0];
        assert_eq!(first.id, "9s8kkmjQPW");
        assert_eq!(first.title, "Flickering Christmas lights");
        assert_eq!(first.duration, Some(13), "13.055s rounds down to 13");
        assert_eq!(first.source, "coverr");
        assert_eq!((first.width, first.height), (1920, 1080));
        assert_eq!(
            first.url,
            "https://cdn.coverr.co/videos/coverr-flickering-christmas-lights-5452/1080p.mp4"
        );
        assert!(first.thumb.contains("/thumbnail?width=640"), "{}", first.thumb);

        let last = &page.items[1];
        assert_eq!(last.title, "coverr-untitled-clip", "title falls back to the file name");
        assert_eq!(last.id, "noTitle");
        assert_eq!(last.duration, Some(3));
        assert_eq!(
            last.url,
            "https://cdn.coverr.co/videos/coverr-untitled-clip/720p.mp4",
            "sub-1080p sources get the 720p rendition"
        );
        assert_eq!(
            last.thumb,
            "https://cdn.coverr.co/videos/coverr-untitled-clip/thumbnail?width=640",
            "a missing thumbnail field falls back to the CDN pattern"
        );
    }

    #[test]
    fn coverr_an_empty_listing_never_offers_more_pages() {
        let page = parse_coverr(r#"{"pages":0,"hits":[]}"#).unwrap();
        assert!(page.items.is_empty());
        assert_eq!(page.last_page, None);
    }
}
