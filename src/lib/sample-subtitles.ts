export interface SampleSubtitleFile {
  id: string;
  titleEn: string;
  titleAr: string;
  descriptionEn: string;
  descriptionAr: string;
  fileName: string;
  sourceLanguage: string;
  content: string;
}

export const SAMPLE_SUBTITLE_FILES: SampleSubtitleFile[] = [
  {
    id: 'detective-drama',
    titleEn: 'Noir Thriller: Sarcasm, Idioms & Gender Context',
    titleAr: 'دراما بوليسية: سخرية وتعابير اصطلاحية وحوارات سياقية',
    descriptionEn: 'Features Detective Elena Vance (female) and Marcus Thorne (male), packed with sarcasm, idioms, formatting tags (<i>, <b>), and recurring terminology.',
    descriptionAr: 'يتضمن حوارات المحققة إيلينا فانس وماركوس ثورن، مع عبارات ساخرة وتعابير مجازية ووسوم تنسيق ومصطلحات متكررة.',
    fileName: 'The_Glass_Archive_S01E04.srt',
    sourceLanguage: 'en',
    content: `1
00:00:01,200 --> 00:00:03,800
<i>[thunder rumbles in the distance]</i>

2
00:00:04,150 --> 00:00:06,900
ELENA: I never thought you would come back to Cairo, Marcus.

3
00:00:07,200 --> 00:00:09,650
MARCUS: I had no other choice, Elena.
The Aegis Syndicate found me.

4
00:00:10,100 --> 00:00:13,400
ELENA: Oh, brilliant! And you decided to bring them
straight to my doorstep? Piece of cake, right?

5
00:00:13,800 --> 00:00:16,950
MARCUS: Stop being sarcastic. You know I wouldn't risk
your life unless Project Horizon was compromised.

6
00:00:17,300 --> 00:00:20,400
ELENA: You're barking up the wrong tree if you think
I'm going to cover for you again.

7
00:00:20,850 --> 00:00:24,100
MARCUS: <i>Listen to me carefully, both of our names
are already on Director Vance's encrypted ledger.</i>

8
00:00:24,500 --> 00:00:27,600
- Are you serious?
- Dead serious. Someone spilled the beans last night.

9
00:00:28,000 --> 00:00:31,250
ELENA: <b>If Victor finds out we have the Glass Archive key,
we're both finished.</b>

10
00:00:31,700 --> 00:00:34,900
MARCUS: Then don't let him catch us off guard.
Are you with me, partner, or am I on my own?

11
00:00:35,300 --> 00:00:38,100
♪ <i>Shadows falling over the Nile</i> ♪

12
00:00:38,500 --> 00:00:41,900
ELENA: Fine. Grab your coat before I change my mind.
`
  },
  {
    id: 'classic-opening',
    titleEn: 'Classic Cinema Dialogue: Quick Test (6 Lines)',
    titleAr: 'حوار سينمائي قصير: اختبار سريع (6 أسطر)',
    descriptionEn: 'A concise 6-entry SRT file ideal for rapid end-to-end translation and formatting verification.',
    descriptionAr: 'ملف ترجمة موجز من 6 مقاطع مثالي للاختبار السريع والتحقق من دقة التوقيت والتنسيق.',
    fileName: 'Classic_Return_Scene.srt',
    sourceLanguage: 'en',
    content: `1
00:00:01,200 --> 00:00:03,500
I never thought you would come back.

2
00:00:04,000 --> 00:00:06,200
I had no other choice.

3
00:00:06,800 --> 00:00:09,400
<i>Did Nadia tell you what happened at the harbor?</i>

4
00:00:10,000 --> 00:00:12,750
She didn't have to say a word.
I saw it in her eyes.

5
00:00:13,200 --> 00:00:16,100
- We are running out of time.
- Keep your voice down! The guards are right outside.

6
00:00:16,600 --> 00:00:19,500
<b>Trust me, this time we finish what we started.</b>
`
  }
];
