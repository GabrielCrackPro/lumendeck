use serde::{Deserialize, Serialize};

pub const SOURCE_BING: &str = "bing";
pub const SOURCE_WALLHAVEN: &str = "wallhaven";
pub const SOURCE_APOD: &str = "apod";
pub const SOURCE_PIXABAY: &str = "pixabay";
pub const SOURCE_COVERR: &str = "coverr";
pub const SOURCE_UNSPLASH: &str = "unsplash";


pub fn requires_api_key(source: &str) -> bool {
    source == SOURCE_PIXABAY || source == SOURCE_UNSPLASH
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
    /// Credit line for sources whose license names a creator (e.g. APOD's copyright field).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attribution: Option<String>,
    /// Source-hosted URL to ping after the user downloads this item; Unsplash's
    /// API guidelines count a download only after its `download_location` is hit.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub download_location: Option<String>,
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
            attribution: None,
            download_location: None,
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
                attribution: None,
                download_location: None,
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
            attribution: None,
            download_location: None,
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
            attribution: None,
            download_location: None,
        });
    }
    Ok(DiscoverPage {
        items,
        last_page: (resp.pages >= 1).then_some(resp.pages),
    })
}


/// APOD's archive opens on this day (1995-06-16), as days since the Unix epoch.
pub const APOD_FIRST_DAYS: i64 = 9_297;
/// Days served by one browse page; the last page carries the remainder.
const APOD_PAGE_DAYS: i64 = 30;

/// Howard Hinnant's `civil_from_days`: epoch days to a proleptic Gregorian date.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11] March = 0
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32; // [1, 12]
    (if m <= 2 { y + 1 } else { y }, m, d)
}

fn apod_date(days: i64) -> String {
    let (y, m, d) = civil_from_days(days);
    format!("{y:04}-{m:02}-{d:02}")
}

/// The inclusive day window one browse page covers, or `None` past the archive.
pub fn apod_page_window(today: i64, page: u32) -> Option<(i64, i64)> {
    let end = today - (page.max(1) as i64 - 1) * APOD_PAGE_DAYS;
    if end < APOD_FIRST_DAYS {
        return None;
    }
    let start = (end - (APOD_PAGE_DAYS - 1)).max(APOD_FIRST_DAYS);
    Some((start, end))
}

pub fn apod_last_page(today: i64) -> u32 {
    ((today - APOD_FIRST_DAYS + APOD_PAGE_DAYS) / APOD_PAGE_DAYS).max(1) as u32
}

/// NASA serves the whole archive behind one key; `DEMO_KEY` works with no signup
/// (30 requests/hour per IP), and a saved free key raises that limit.
pub fn apod_feed_url(today: i64, page: u32, api_key: &str) -> Option<String> {
    let (start, end) = apod_page_window(today, page)?;
    let key = api_key.trim();
    let key = if key.is_empty() { "DEMO_KEY" } else { key };
    let mut url = url::Url::parse("https://api.nasa.gov/planetary/apod")
        .expect("the NASA APOD base URL is a valid URL");
    {
        let mut pairs = url.query_pairs_mut();
        pairs.append_pair("api_key", key);
        pairs.append_pair("start_date", &apod_date(start));
        pairs.append_pair("end_date", &apod_date(end));
    }
    Some(url.to_string())
}

fn unix_days_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64 / 86_400)
        .unwrap_or(APOD_FIRST_DAYS)
}

#[derive(Deserialize)]
struct ApodEntry {
    #[serde(default)]
    date: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    url: String,
    #[serde(default)]
    hdurl: Option<String>,
    #[serde(default)]
    media_type: Option<String>,
    #[serde(default)]
    copyright: Option<String>,
}

pub fn parse_apod(json: &str, today: i64) -> Result<DiscoverPage, String> {
    let entries: Vec<ApodEntry> = serde_json::from_str(json)
        .map_err(|e| format!("NASA APOD response unreadable: {e}"))?;
    let mut items = Vec::new();
    let mut seen_dates: std::collections::HashSet<String> = Default::default();
    for e in entries {
        // APOD videos are hosted on video platforms, not downloadable files.
        if e.media_type.as_deref().unwrap_or("image") != "image" {
            continue;
        }
        if e.url.is_empty() || !e.url.starts_with("https://") {
            continue;
        }
        let full = e
            .hdurl
            .filter(|h| h.starts_with("https://"))
            .unwrap_or_else(|| e.url.clone());
        let title = if e.title.trim().is_empty() {
            e.date.clone()
        } else {
            e.title
        };
        let attribution = e
            .copyright
            .map(|c| c.split_whitespace().collect::<Vec<_>>().join(" "))
            .filter(|c| !c.is_empty());
        // APOD sometimes posts two pictures on one date; keep both, uniquely keyed.
        let base = if e.date.is_empty() {
            format!("apod-{}", items.len())
        } else {
            e.date.clone()
        };
        let id = if seen_dates.insert(base.clone()) {
            base
        } else {
            format!("{base}-{}", items.len())
        };
        items.push(DiscoverItem {
            id,
            title,
            url: full,
            thumb: e.url,
            // APOD reports no dimensions; the UI hides the badge for 0×0.
            width: 0,
            height: 0,
            duration: None,
            source: SOURCE_APOD.to_string(),
            attribution,
            download_location: None,
        });
    }
    // The API answers newest-first; sort anyway so tests and paging stay stable.
    items.sort_by(|a, b| b.id.cmp(&a.id));
    Ok(DiscoverPage {
        items,
        last_page: Some(apod_last_page(today)),
    })
}

/// Unsplash needs a free access key on every call. The key rides in a query
/// parameter, which keeps it out of the header machinery `get_text` lacks.
pub fn unsplash_search_url(query: &str, page: u32, api_key: &str) -> Result<String, String> {
    let key = api_key.trim();
    if key.is_empty() {
        return Err("Unsplash needs an API key (free at unsplash.com/developers)".into());
    }
    let mut url = url::Url::parse("https://api.unsplash.com/search/photos")
        .expect("the Unsplash base URL is a valid URL");
    {
        let mut pairs = url.query_pairs_mut();
        pairs.append_pair("client_id", key);
        let q = query.trim();
        if !q.is_empty() {
            pairs.append_pair("query", q);
        }
        pairs.append_pair("per_page", "30");
        pairs.append_pair("content_filter", "high");
        if page > 1 {
            pairs.append_pair("page", &page.to_string());
        }
    }
    Ok(url.to_string())
}

#[derive(Deserialize)]
struct UnsplashSearch {
    #[serde(default)]
    total: Option<u64>,
    // Required on purpose: an API error body (`{"errors":[...]}`) must surface
    // as a failed fetch, not read as "no results".
    results: Vec<UnsplashPhoto>,
}

#[derive(Deserialize)]
struct UnsplashPhoto {
    #[serde(default)]
    id: String,
    #[serde(default)]
    width: Option<u32>,
    #[serde(default)]
    height: Option<u32>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    alt_description: Option<String>,
    #[serde(default)]
    urls: Option<UnsplashUrls>,
    #[serde(default)]
    links: Option<UnsplashLinks>,
    #[serde(default)]
    user: Option<UnsplashUser>,
}

#[derive(Deserialize)]
struct UnsplashUrls {
    #[serde(default)]
    full: Option<String>,
    #[serde(default)]
    regular: Option<String>,
    #[serde(default)]
    small: Option<String>,
}

#[derive(Deserialize)]
struct UnsplashLinks {
    #[serde(default)]
    download: Option<String>,
    #[serde(default)]
    download_location: Option<String>,
}

#[derive(Deserialize)]
struct UnsplashUser {
    #[serde(default)]
    name: String,
    #[serde(default)]
    username: String,
}

/// The credit line the guidelines ask for: photographer first, then Unsplash.
fn unsplash_credit(user: &UnsplashUser) -> Option<String> {
    let name = user.name.split_whitespace().collect::<Vec<_>>().join(" ");
    let name = if name.is_empty() {
        user.username.trim().to_string()
    } else {
        name
    };
    if name.is_empty() {
        None
    } else {
        Some(format!("Photo by {name} on Unsplash"))
    }
}

pub fn parse_unsplash(json: &str) -> Result<DiscoverPage, String> {
    let resp: UnsplashSearch =
        serde_json::from_str(json).map_err(|e| format!("Unsplash response unreadable: {e}"))?;
    let mut items = Vec::new();
    for photo in resp.results {
        let Some(urls) = photo.urls.as_ref() else {
            continue;
        };
        // The guidelines ask that full-resolution files come from `download`,
        // not the hotlink CDN, so a photo with no download link is not offered.
        let Some(download) = photo
            .links
            .as_ref()
            .and_then(|l| l.download.as_deref())
            .filter(|d| d.starts_with("https://"))
        else {
            continue;
        };
        // The CDN hotlink is only ever a thumbnail; the file itself is `download`.
        let thumb = [urls.small.as_deref(), urls.regular.as_deref()]
            .into_iter()
            .flatten()
            .find(|u| u.starts_with("https://"))
            .unwrap_or(download);
        if photo.id.is_empty() || thumb.is_empty() {
            continue;
        }
        let attribution = photo.user.as_ref().and_then(unsplash_credit);
        let title = photo
            .alt_description
            .as_deref()
            .map(str::trim)
            .filter(|t| !t.is_empty())
            .or_else(|| {
                photo
                    .description
                    .as_deref()
                    .map(str::trim)
                    .filter(|t| !t.is_empty())
            })
            .unwrap_or(&photo.id)
            .to_string();
        items.push(DiscoverItem {
            id: photo.id.clone(),
            title,
            url: download.to_string(),
            thumb: thumb.to_string(),
            width: photo.width.unwrap_or(0),
            height: photo.height.unwrap_or(0),
            duration: None,
            source: SOURCE_UNSPLASH.to_string(),
            attribution,
            // Hitting this URL is what Unsplash counts as the download.
            download_location: photo
                .links
                .as_ref()
                .and_then(|l| l.download_location.clone())
                .filter(|d| d.starts_with("https://")),
        });
    }
    let per_page = 30u64;
    let last_page = resp
        .total
        .map(|t| (t.div_ceil(per_page)).max(1).min(u32::MAX as u64) as u32);
    Ok(DiscoverPage {
        items,
        last_page,
    })
}

/// The guidelines require counting a download only after its `download_location`
/// answers, so the ping must be authorized like any other call.
pub fn unsplash_ping_url(download_location: &str, api_key: &str) -> Result<String, String> {
    let key = api_key.trim();
    if key.is_empty() {
        return Err("Unsplash needs an API key (free at unsplash.com/developers)".into());
    }
    let mut url = url::Url::parse(download_location)
        .map_err(|_| "not a valid download reference".to_string())?;
    if url.scheme() != "https" {
        return Err("download reference must be https".into());
    }
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    if host != "api.unsplash.com" {
        return Err(format!("unexpected download host: {host}"));
    }
    url.query_pairs_mut().append_pair("client_id", key);
    Ok(url.to_string())
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
        SOURCE_BING
            | SOURCE_WALLHAVEN
            | SOURCE_APOD
            | SOURCE_PIXABAY
            | SOURCE_COVERR
            | SOURCE_UNSPLASH
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
        SOURCE_APOD => {
            let today = unix_days_now();
            let url = apod_feed_url(today, page.max(1), &stored.api_key)
                .ok_or_else(|| "no NASA pictures that far back".to_string())?;
            let body = get_text(&url).await?;
            parse_apod(&body, today)
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
        SOURCE_UNSPLASH => {
            let url = unsplash_search_url(query, page.max(1), &stored.api_key)?;
            let body = get_text(&url).await?;
            parse_unsplash(&body)
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
        || host == "apod.nasa.gov"
        || host.ends_with(".apod.nasa.gov")
        || host == "images.unsplash.com"
        || host.ends_with(".images.unsplash.com")
        || host == "unsplash.com"
        || host.ends_with(".unsplash.com")
}

/// Fire the download credit Unsplash's guidelines require. The ping failing is
/// not worth failing the user's import, so callers treat this as best-effort.
pub async fn ping_unsplash_download(
    download_location: &str,
    api_key: &str,
) -> Result<(), String> {
    let url = unsplash_ping_url(download_location, api_key)?;
    get_text(&url).await.map(|_| ())
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
            "apod.nasa.gov",
            "www.apod.nasa.gov",
            "images.unsplash.com",
            "plus.unsplash.com",
            "unsplash.com",
        ] {
            assert!(is_allowed_host(ok), "{ok} should be allowed");
        }
        for bad in [
            "evil.com",
            "wallhaven.cc.evil.com",
            "notwallhaven.cc",
            "pixabay.com.evil.com",
            "notcoverr.co",
            "apod.nasa.gov.evil.com",
            "images.unsplash.com.evil.com",
            "nasa.gov",
            "192.168.1.1",
            "localhost",
        ] {
            assert!(!is_allowed_host(bad), "{bad} must be refused");
        }
    }

    #[test]
    fn civil_from_days_hits_the_calendar_landmarks() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(10_957), (2000, 1, 1));
        // APOD's first picture, and a leap day inside its range.
        assert_eq!(civil_from_days(APOD_FIRST_DAYS), (1995, 6, 16));
        assert_eq!(civil_from_days(11_016), (2000, 2, 29));
    }

    #[test]
    fn apod_pages_walk_backwards_from_today_in_month_windows() {
        let today = APOD_FIRST_DAYS + 61;
        assert_eq!(apod_page_window(today, 1), Some((today - 29, today)));
        assert_eq!(
            apod_page_window(today, 2),
            Some((today - 59, today - 30)),
            "pages tile the calendar without overlap"
        );
        // Only three days of archive exist; the second page would be empty.
        let young = APOD_FIRST_DAYS + 2;
        assert_eq!(apod_page_window(young, 1), Some((APOD_FIRST_DAYS, young)));
        assert_eq!(apod_page_window(young, 2), None);
        assert_eq!(apod_page_window(APOD_FIRST_DAYS, 99), None);
    }

    #[test]
    fn apod_last_page_covers_the_whole_archive() {
        assert_eq!(apod_last_page(APOD_FIRST_DAYS), 1);
        assert_eq!(apod_last_page(APOD_FIRST_DAYS + 29), 1);
        assert_eq!(apod_last_page(APOD_FIRST_DAYS + 30), 2);
        // The final page holds the remainder, never an empty window.
        let today = APOD_FIRST_DAYS + 44;
        let last = apod_last_page(today);
        let (start_of_last, _) = apod_page_window(today, last).unwrap();
        assert_eq!(start_of_last, APOD_FIRST_DAYS);
    }

    #[test]
    fn apod_feed_url_uses_the_shared_demo_key_by_default() {
        let today = APOD_FIRST_DAYS + 40;
        let url = apod_feed_url(today, 1, "  ").unwrap();
        assert!(
            url.starts_with("https://api.nasa.gov/planetary/apod?"),
            "{url}"
        );
        assert!(url.contains("api_key=DEMO_KEY"), "{url}");
        assert!(
            url.contains(&format!("end_date={}", apod_date(today))),
            "{url}"
        );
        assert!(
            url.contains(&format!("start_date={}", apod_date(today - 29))),
            "{url}"
        );

        let keyed = apod_feed_url(today, 1, " MY-NASA-KEY ").unwrap();
        assert!(keyed.contains("api_key=MY-NASA-KEY"), "{keyed}");
        assert!(!keyed.contains("DEMO_KEY"), "{keyed}");
    }

    #[test]
    fn a_page_past_the_archive_has_no_url() {
        assert!(apod_feed_url(APOD_FIRST_DAYS, 2, "").is_none());
    }

    const APOD_LIVE: &str = r#"[{"date":"2026-10-08","explanation":"...","hdurl":"https://apod.nasa.gov/apod/image/2610/NorthAmericaNebula_1024.jpg","media_type":"image","service_version":"v1","title":"The North America Nebula","url":"https://apod.nasa.gov/apod/image/2610/NorthAmericaNebula.jpg"},{"copyright":"  John Doe  ","date":"2026-10-07","media_type":"image","title":"Sunset over the Alps","url":"https://apod.nasa.gov/apod/image/2610/sunsetAlps.jpg"},{"date":"2026-10-06","media_type":"video","title":"Aurora Time-Lapse","url":"https://www.youtube.com/watch?v=abc123"},{"date":"2026-10-05","media_type":"image","title":"Plain HTTP","url":"http://apod.nasa.gov/apod/image/2610/insecure.jpg"}]"#;

    #[test]
    fn apod_parses_live_json() {
        let today = APOD_FIRST_DAYS + 11_000;
        let page = parse_apod(APOD_LIVE, today).expect("live-shaped response must parse");
        assert_eq!(page.last_page, Some(apod_last_page(today)));
        assert_eq!(page.items.len(), 2, "videos and http links are dropped");

        let first = &page.items[0];
        assert_eq!(first.id, "2026-10-08");
        assert_eq!(first.title, "The North America Nebula");
        assert_eq!(
            first.url,
            "https://apod.nasa.gov/apod/image/2610/NorthAmericaNebula_1024.jpg",
            "the HD rendition is the wallpaper"
        );
        assert_eq!(
            first.thumb,
            "https://apod.nasa.gov/apod/image/2610/NorthAmericaNebula.jpg",
            "the screen-size image is the thumbnail"
        );
        assert_eq!(first.source, "apod");
        assert_eq!(first.attribution, None);
        assert_eq!((first.width, first.height), (0, 0));

        let second = &page.items[1];
        assert_eq!(second.id, "2026-10-07");
        assert_eq!(second.url, second.thumb, "no hdurl falls back to the image");
        assert_eq!(
            second.attribution.as_deref(),
            Some("John Doe"),
            "copyright whitespace collapses to a credit chip"
        );
    }

    #[test]
    fn apod_keeps_two_pictures_on_one_date_uniquely_keyed() {
        let json = r#"[{"date":"2026-01-01","title":"First","url":"https://apod.nasa.gov/a.jpg"},{"date":"2026-01-01","title":"Second","url":"https://apod.nasa.gov/b.jpg"}]"#;
        let page = parse_apod(json, APOD_FIRST_DAYS).unwrap();
        let ids: Vec<&str> = page.items.iter().map(|i| i.id.as_str()).collect();
        assert_eq!(ids.len(), 2);
        assert_ne!(ids[0], ids[1], "duplicate dates must not share an id");
    }

    #[test]
    fn apod_an_unreadable_body_is_an_error() {
        assert!(parse_apod("{\"error\":true}", APOD_FIRST_DAYS).is_err());
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

    #[test]
    fn unsplash_search_url_needs_a_key_and_pins_the_params() {
        let err = unsplash_search_url("forest", 1, "   ").unwrap_err();
        assert!(err.to_lowercase().contains("api key"), "{err}");

        let url = unsplash_search_url("dark forest", 1, " KEY123 ").unwrap();
        assert!(
            url.starts_with("https://api.unsplash.com/search/photos?"),
            "{url}"
        );
        assert!(url.contains("client_id=KEY123"), "{url}");
        assert!(url.contains("query=dark+forest"), "{url}");
        assert!(url.contains("per_page=30"), "{url}");
        assert!(url.contains("content_filter=high"), "{url}");
        assert!(
            !url.split('&').any(|p| p.starts_with("page=")),
            "page 1 stays implicit: {url}"
        );

        let page3 = unsplash_search_url("", 3, "KEY123").unwrap();
        assert!(page3.contains("page=3"), "{page3}");
        assert!(!page3.contains("query="), "empty query omitted: {page3}");
    }

    const UNSPLASH_LIVE: &str = r#"{"total":1200,"results":[{"id":"abc123","width":4000,"height":6000,"description":"A quiet mountain lake at dawn","alt_description":"mountain lake at dawn","urls":{"raw":"https://images.unsplash.com/photo-abc123","full":"https://images.unsplash.com/photo-abc123","regular":"https://images.unsplash.com/photo-abc123?w=1080","small":"https://images.unsplash.com/photo-abc123?w=400"},"links":{"self":"https://api.unsplash.com/photos/abc123","html":"https://unsplash.com/photos/abc123","download":"https://api.unsplash.com/download/abc123","download_location":"https://api.unsplash.com/photos/abc123/download"},"user":{"id":"u1","username":"somebody","name":"  Jane   Doe  "}},{"id":"noUser","urls":{"regular":"https://images.unsplash.com/photo-noUser?w=1080"},"links":{"download":"https://api.unsplash.com/download/noUser","download_location":"https://api.unsplash.com/photos/noUser/download"},"user":{"name":"","username":"somebody"}},{"id":"noDownload","urls":{"regular":"https://images.unsplash.com/photo-noDownload?w=1080"},"links":{"download_location":"https://api.unsplash.com/photos/noDownload/download"},"user":{"name":"Solo"}},{"id":"ghost","urls":{"regular":"https://images.unsplash.com/photo-ghost?w=1080"},"links":{"download":"https://api.unsplash.com/download/ghost","download_location":"https://api.unsplash.com/photos/ghost/download"}}]}"#;

    #[test]
    fn unsplash_parses_live_json_with_credit_and_download_link() {
        let page = parse_unsplash(UNSPLASH_LIVE).expect("live-shaped response must parse");
        assert_eq!(page.last_page, Some(40), "1200 results over 30 per page");
        assert_eq!(
            page.items.len(),
            3,
            "the photo without a download link is dropped"
        );

        let first = &page.items[0];
        assert_eq!(first.id, "abc123");
        assert_eq!(first.title, "mountain lake at dawn", "alt_description wins");
        assert_eq!(
            first.url,
            "https://api.unsplash.com/download/abc123",
            "the file comes from the download link, not the hotlink CDN"
        );
        assert_eq!(
            first.thumb,
            "https://images.unsplash.com/photo-abc123?w=400",
            "the small rendition is the thumbnail"
        );
        assert_eq!((first.width, first.height), (4000, 6000));
        assert_eq!(first.source, "unsplash");
        assert_eq!(
            first.attribution.as_deref(),
            Some("Photo by Jane Doe on Unsplash"),
            "copyright whitespace collapses into the credit line"
        );
        assert_eq!(
            first.download_location.as_deref(),
            Some("https://api.unsplash.com/photos/abc123/download")
        );

        let second = &page.items[1];
        assert_eq!(second.title, "noUser", "title falls back to the id");
        assert_eq!(
            second.attribution.as_deref(),
            Some("Photo by somebody on Unsplash"),
            "the username stands in when the display name is blank"
        );
        assert_eq!(
            page.items[2].attribution, None,
            "a photo with no user carries no credit rather than a fabricated one"
        );
    }

    #[test]
    fn unsplash_an_unreadable_body_is_an_error() {
        assert!(parse_unsplash("{\"error\":true}").is_err());
    }

    #[test]
    fn unsplash_ping_url_authorizes_and_pins_the_host() {
        let url = unsplash_ping_url("https://api.unsplash.com/photos/abc123/download", " KEY ")
            .unwrap();
        assert!(url.contains("client_id=KEY"), "{url}");
        assert!(
            url.starts_with("https://api.unsplash.com/photos/abc123/download?"),
            "{url}"
        );

        assert!(unsplash_ping_url("https://api.unsplash.com/photos/x/download", "").is_err());
        for bad in [
            "http://api.unsplash.com/photos/x/download",
            "https://evil.com/photos/x/download",
            "https://api.unsplash.com.evil.com/photos/x/download",
            "not a url",
        ] {
            assert!(
                unsplash_ping_url(bad, "KEY").is_err(),
                "{bad} should be refused"
            );
        }
    }

    #[test]
    fn unsplash_without_a_key_fails_before_any_request() {
        let rt = Runtime::new().unwrap();
        let cfg = crate::config::DiscoverConfig::default();
        let err = rt.block_on(list("unsplash", "", 1, &cfg)).unwrap_err();
        assert!(err.to_lowercase().contains("api key"), "{err}");
    }
}
