import { NextRequest, NextResponse } from 'next/server';
import {
  extractYouTubeVideoId,
  parseYouTubeTranscriptPayload,
} from '@/lib/srt/youtube';
import { serializeTimedSubtitle } from '@/lib/srt/sync';

interface YouTubeCaptionTrackMeta {
  baseUrl?: string;
  vssId?: string;
  languageCode?: string;
  kind?: string;
  name?: {
    simpleText?: string;
    runs?: Array<{ text?: string }>;
  };
}

interface YouTubePlayerPayload {
  videoDetails?: {
    videoId?: string;
    title?: string;
    lengthSeconds?: string;
  };
  captions?: {
    playerCaptionsTracklistRenderer?: {
      captionTracks?: YouTubeCaptionTrackMeta[];
    };
  };
}

function getTrackLabel(track: YouTubeCaptionTrackMeta): string {
  if (track.name?.simpleText) return track.name.simpleText;
  if (Array.isArray(track.name?.runs)) {
    return track.name.runs.map((r) => r.text || '').join('').trim();
  }
  return track.languageCode || 'Unknown';
}

function isSafeYouTubeCaptionUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    return host === 'www.youtube.com' || host === 'youtube.com' || host.endsWith('.youtube.com');
  } catch {
    return false;
  }
}

function extractBalancedJsonObject(source: string, marker: string): YouTubePlayerPayload | null {
  const markerIdx = source.indexOf(marker);
  if (markerIdx === -1) return null;

  const braceStart = source.indexOf('{', markerIdx + marker.length);
  if (braceStart === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = braceStart; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const jsonCandidate = source.slice(braceStart, i + 1);
        try {
          return JSON.parse(jsonCandidate) as YouTubePlayerPayload;
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}

async function fetchPlayerPayloadForVideo(videoId: string): Promise<YouTubePlayerPayload | null> {
  const commonHeaders = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
    Cookie: 'CONSENT=YES+cb.20230531-07-p0.en+FX+908',
  };

  // Strategy 1: Innertube player endpoint
  try {
    const innertubeRes = await fetch(
      'https://www.youtube.com/youtubei/v1/player?prettyPrint=false',
      {
        method: 'POST',
        headers: {
          ...commonHeaders,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          context: {
            client: {
              clientName: 'WEB',
              clientVersion: '2.20250101.00.00',
              hl: 'en',
              gl: 'US',
            },
          },
          videoId,
        }),
        signal: AbortSignal.timeout(9000),
      }
    );

    if (innertubeRes.ok) {
      const data = (await innertubeRes.json()) as YouTubePlayerPayload;
      if (data?.captions?.playerCaptionsTracklistRenderer?.captionTracks?.length) {
        return data;
      }
    }
  } catch {
    // Fall back to watch page HTML extraction
  }

  // Strategy 2: Watch page ytInitialPlayerResponse extraction
  try {
    const watchRes = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=en`, {
      headers: commonHeaders,
      signal: AbortSignal.timeout(9000),
    });
    if (!watchRes.ok) return null;
    const html = await watchRes.text();
    return (
      extractBalancedJsonObject(html, 'ytInitialPlayerResponse =') ||
      extractBalancedJsonObject(html, 'var ytInitialPlayerResponse =')
    );
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      videoIdOrUrl?: string;
      preferredLang?: string;
    };

    const videoId = extractYouTubeVideoId(body.videoIdOrUrl || '');
    if (!videoId) {
      return NextResponse.json(
        {
          errorCode: 'INVALID_ID',
          message: 'Invalid YouTube URL or Video ID.',
        },
        { status: 400 }
      );
    }

    const playerPayload = await fetchPlayerPayloadForVideo(videoId);
    const tracks =
      playerPayload?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];

    if (!tracks.length) {
      return NextResponse.json(
        {
          errorCode: 'NO_CAPTIONS',
          videoId,
          title: playerPayload?.videoDetails?.title || '',
          message:
            'Could not auto-fetch captions from YouTube for this video (either captions are disabled or blocked on this host). Use the built-in Interactive YouTube Player below to sync visually with 1 click, or paste the transcript text.',
        },
        { status: 422 }
      );
    }

    const preferred = (body.preferredLang || 'en').toLowerCase();
    const sortedTracks = [...tracks].sort((a, b) => {
      const aLang = (a.languageCode || '').toLowerCase();
      const bLang = (b.languageCode || '').toLowerCase();
      const aManual = a.kind !== 'asr' ? 1 : 0;
      const bManual = b.kind !== 'asr' ? 1 : 0;

      const aMatchesPref = aLang === preferred || aLang.startsWith(`${preferred}-`) ? 1 : 0;
      const bMatchesPref = bLang === preferred || bLang.startsWith(`${preferred}-`) ? 1 : 0;
      if (aMatchesPref !== bMatchesPref) return bMatchesPref - aMatchesPref;

      const aIsEn = aLang === 'en' || aLang.startsWith('en-') ? 1 : 0;
      const bIsEn = bLang === 'en' || bLang.startsWith('en-') ? 1 : 0;
      if (aIsEn !== bIsEn) return bIsEn - aIsEn;

      return bManual - aManual;
    });

    const chosenTrack = sortedTracks[0];
    if (!chosenTrack?.baseUrl || !isSafeYouTubeCaptionUrl(chosenTrack.baseUrl)) {
      return NextResponse.json(
        {
          errorCode: 'NO_CAPTIONS',
          videoId,
          message: 'No valid YouTube caption track URL was found.',
        },
        { status: 422 }
      );
    }

    // Fetch JSON3 first, then fall back to default XML/SRV1 format
    let cues = [] as ReturnType<typeof parseYouTubeTranscriptPayload>;
    const json3Url = `${chosenTrack.baseUrl}${
      chosenTrack.baseUrl.includes('?') ? '&' : '?'
    }fmt=json3`;

    if (isSafeYouTubeCaptionUrl(json3Url)) {
      try {
        const resJson3 = await fetch(json3Url, { signal: AbortSignal.timeout(8000) });
        if (resJson3.ok) {
          const textJson3 = await resJson3.text();
          cues = parseYouTubeTranscriptPayload(textJson3);
        }
      } catch {
        // Fall through to XML fetch
      }
    }

    if (cues.length === 0) {
      const resXml = await fetch(chosenTrack.baseUrl, { signal: AbortSignal.timeout(8000) });
      if (resXml.ok) {
        const textXml = await resXml.text();
        cues = parseYouTubeTranscriptPayload(textXml);
      }
    }

    if (cues.length === 0) {
      return NextResponse.json(
        {
          errorCode: 'NO_CAPTIONS',
          videoId,
          title: playerPayload?.videoDetails?.title || '',
          message:
            'Caption track returned empty segments. Use the Interactive YouTube Player below to sync with 1 click or paste the transcript text.',
        },
        { status: 422 }
      );
    }

    const availableTracks = tracks.map((t) => ({
      languageCode: t.languageCode || 'en',
      label: getTrackLabel(t),
      isAutoGenerated: t.kind === 'asr',
    }));

    return NextResponse.json({
      videoId,
      title: playerPayload?.videoDetails?.title || `YouTube_${videoId}`,
      languageCode: chosenTrack.languageCode || 'en',
      languageName: getTrackLabel(chosenTrack),
      isAutoGenerated: chosenTrack.kind === 'asr',
      availableTracks,
      cues,
      srtContent: serializeTimedSubtitle(cues, 'srt'),
    });
  } catch (err) {
    return NextResponse.json(
      {
        errorCode: 'FETCH_BLOCKED',
        message:
          err instanceof Error
            ? err.message
            : 'Failed to fetch YouTube captions from server.',
      },
      { status: 500 }
    );
  }
}
