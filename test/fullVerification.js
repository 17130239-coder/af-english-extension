/**
 * End-to-End Verification Test Suite
 * Tests subtitle parsers, POS vocabulary analyzer, dictionary lookup, and export generators.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// 1. Load Modules
const SubtitleParser = require('../lib/subtitleParser.js');
const CefrDict = require('../lib/cefrDict.js');
const VocabAnalyzer = require('../lib/vocabAnalyzer.js');

console.log('====================================================');
console.log('🧪 RUNNING EXPANDED AF ENGLISH VERIFICATION SUITE');
console.log('====================================================\n');

let testsPassed = 0;
let testsTotal = 0;

function runTest(name, fn) {
  testsTotal++;
  try {
    fn();
    console.log(`  ✓ PASSED: ${name}`);
    testsPassed++;
  } catch (err) {
    console.error(`  ❌ FAILED: ${name}`);
    console.error('    Error:', err.message);
    if (err.stack) console.error(err.stack);
    process.exitCode = 1;
  }
}

// -------------------------------------------------------------
// Test 1: Subtitle Parser - WebVTT
// -------------------------------------------------------------
runTest('Subtitle Parser - WebVTT parsing & normalization', () => {
  const vttSample = `WEBVTT - Sample Netflix Video

00:00:01.000 --> 00:00:04.500 position:50% line:0%
The <i>brilliant</i> detective quickly solved complicated mysteries.

2
00:00:05.200 --> 00:00:09.800
Scientists discovered an extraordinarily beautiful ancient civilization.
`;

  const cues = SubtitleParser.parse(vttSample);
  assert.strictEqual(cues.length, 2, 'Should parse 2 cues');
  assert.strictEqual(cues[0].startSec, 1.0);
  assert.strictEqual(cues[0].endSec, 4.5);
  assert.strictEqual(cues[0].cleanText, 'The brilliant detective quickly solved complicated mysteries.');
  assert.strictEqual(cues[1].startSec, 5.2);
  assert.strictEqual(cues[1].endSec, 9.8);
  assert.strictEqual(cues[1].cleanText, 'Scientists discovered an extraordinarily beautiful ancient civilization.');
});

// -------------------------------------------------------------
// Test 2: Subtitle Parser - SubRip (SRT) & Entity Decoding
// -------------------------------------------------------------
runTest('Subtitle Parser - SubRip (SRT) with decimal & hex entities', () => {
  const srtSample = `1
00:01:23,456 --> 00:01:26,789
<font color="#ffff00">He was running fast&#39;n&#x27;free &amp; happy</font>

2
00:01:27,000 --> 00:01:31,500
because the mysterious stranger <b>walked silently</b>.
`;

  const cues = SubtitleParser.parse(srtSample);
  assert.strictEqual(cues.length, 2);
  assert.strictEqual(cues[0].cleanText, "He was running fast'n'free & happy");
  assert.strictEqual(cues[1].cleanText, 'because the mysterious stranger walked silently.');
  assert.ok(Math.abs(cues[0].startSec - 83.456) < 0.001);
});

// -------------------------------------------------------------
// Test 3: Subtitle Parser - Netflix TTML / IMSC1 XML
// -------------------------------------------------------------
runTest('Subtitle Parser - Netflix TTML / IMSC1 XML', () => {
  const ttmlSample = `<?xml version="1.0" encoding="utf-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling">
  <body>
    <div>
      <p begin="00:00:10.500" end="00:00:14.250">
        <span>The government announced major reforms today.</span>
      </p>
      <p begin="00:00:15.000" dur="00:00:03.000">
        <span>Citizens welcomed the decisive policy warmly.</span>
      </p>
    </div>
  </body>
</tt>`;

  const cues = SubtitleParser.parse(ttmlSample);
  assert.strictEqual(cues.length, 2);
  assert.strictEqual(cues[0].startSec, 10.5);
  assert.strictEqual(cues[0].endSec, 14.25);
  assert.strictEqual(cues[0].cleanText, 'The government announced major reforms today.');
  assert.strictEqual(cues[1].startSec, 15.0);
  assert.strictEqual(cues[1].endSec, 18.0);
  assert.strictEqual(cues[1].cleanText, 'Citizens welcomed the decisive policy warmly.');
});

// -------------------------------------------------------------
// Test 4: Subtitle Parser - YouTube TimedText (XML & JSON3)
// -------------------------------------------------------------
runTest('Subtitle Parser - YouTube TimedText XML & JSON3', () => {
  const ytXml = `<transcript>
  <text start="2.4" dur="3.5">Welcome back to our English lesson.</text>
  <text start="6.1" dur="4.2">Today we will analyze complex vocabulary effortlessly.</text>
</transcript>`;

  const cuesXml = SubtitleParser.parse(ytXml);
  assert.strictEqual(cuesXml.length, 2);
  assert.strictEqual(cuesXml[0].startSec, 2.4);
  assert.strictEqual(cuesXml[0].endSec, 5.9);
  assert.strictEqual(cuesXml[0].cleanText, 'Welcome back to our English lesson.');

  const ytJson3 = {
    events: [
      { tStartMs: 1000, dDurationMs: 3000, segs: [{ utf8: 'Hello ' }, { utf8: 'world!' }] },
      { tStartMs: 4500, dDurationMs: 2500, segs: [{ utf8: 'Learning English.' }] }
    ]
  };

  const cuesJson = SubtitleParser.parse(ytJson3);
  assert.strictEqual(cuesJson.length, 2);
  assert.strictEqual(cuesJson[0].startSec, 1.0);
  assert.strictEqual(cuesJson[0].endSec, 4.0);
  assert.strictEqual(cuesJson[0].cleanText, 'Hello world!');
});

// -------------------------------------------------------------
// Test 5: Subtitle Serializers (.srt, .vtt, .txt)
// -------------------------------------------------------------
runTest('Subtitle Serializers (.srt, .vtt, .txt)', () => {
  const cues = [
    { index: 1, startSec: 10, endSec: 14, start: '00:00:10.000', end: '00:00:14.000', cleanText: 'Hello world.' },
    { index: 2, startSec: 15, endSec: 18, start: '00:00:15.000', end: '00:00:18.000', cleanText: 'Enjoy learning English.' }
  ];

  const srtOutput = SubtitleParser.toSRT(cues);
  assert.ok(srtOutput.includes('00:00:10,000 --> 00:00:14,000'), 'SRT should use comma for milliseconds');
  assert.ok(srtOutput.includes('Hello world.'));

  const vttOutput = SubtitleParser.toWebVTT(cues);
  assert.ok(vttOutput.startsWith('WEBVTT'), 'VTT should start with WEBVTT');
  assert.ok(vttOutput.includes('00:00:10.000 --> 00:00:14.000'), 'VTT should use dot for milliseconds');

  const txtOutput = SubtitleParser.toReadableTranscript(cues);
  assert.ok(txtOutput.includes('Hello world. Enjoy learning English.'), 'TXT should form smooth paragraphs');
});

// -------------------------------------------------------------
// Test 6: CEFR & Vietnamese Dictionary Lookup with Morphological Fallbacks
// -------------------------------------------------------------
runTest('CEFR & Vietnamese Dictionary Lookup with Morphological Fallbacks', () => {
  // Direct lookup
  const word1 = CefrDict.lookup('detective');
  assert.ok(word1 !== null, 'detective should exist');
  assert.strictEqual(word1.cefr, 'B1');
  assert.ok(word1.vi.includes('thám tử'));

  // Adverb suffix fallback
  const word2 = CefrDict.lookup('silently');
  assert.ok(word2 !== null, 'silently should fallback to silent');
  assert.ok(word2.vi.includes('yên lặng') || word2.vi.includes('lặng'));

  // Plural noun fallback
  const word3 = CefrDict.lookup('mysteries');
  assert.ok(word3 !== null, 'mysteries should fallback to mystery');
  assert.ok(word3.vi.includes('bí ẩn'));

  // Past tense verb fallback
  const word4 = CefrDict.lookup('discovered');
  assert.ok(word4 !== null, 'discovered should fallback to discover');
  assert.ok(word4.vi.includes('khám phá') || word4.vi.includes('phát hiện'));

  // Gerund verb fallback
  const word5 = CefrDict.lookup('walking');
  assert.ok(word5 !== null, 'walking should fallback to walk');
  assert.ok(word5.vi.includes('đi bộ') || word5.vi.includes('bộ'));

  const level = CefrDict.getLevel('extraordinarily');
  assert.ok(level === 'C1' || level === 'B2');
});

// -------------------------------------------------------------
// Test 7: POS Vocabulary Analyzer - Separation into 4 Categories
// -------------------------------------------------------------
runTest('Vocabulary Analyzer - Accurate POS classification & Lemmatization', () => {
  const cues = [
    {
      index: 1,
      startSec: 12.5,
      endSec: 16.0,
      start: '00:00:12.500',
      end: '00:00:16.000',
      cleanText: 'The brilliant detective quickly solved complicated mysteries in London.'
    },
    {
      index: 2,
      startSec: 17.0,
      endSec: 21.0,
      start: '00:00:17.000',
      end: '00:00:21.000',
      cleanText: 'He was running fast because the mysterious stranger walked silently.'
    },
    {
      index: 3,
      startSec: 22.0,
      endSec: 27.5,
      start: '00:00:22.000',
      end: '00:00:27.500',
      cleanText: 'Scientists discovered an extraordinarily beautiful ancient civilization.'
    }
  ];

  const analysis = VocabAnalyzer.analyzeSubtitles(cues);

  assert.ok(analysis.summary.totalWords > 0);
  assert.ok(analysis.nouns.length > 0, 'Should find nouns');
  assert.ok(analysis.verbs.length > 0, 'Should find verbs');
  assert.ok(analysis.adjectives.length > 0, 'Should find adjectives');
  assert.ok(analysis.adverbs.length > 0, 'Should find adverbs');

  // Verify Nouns:
  const nounWords = analysis.nouns.map(n => n.word);
  assert.ok(nounWords.includes('detective'), 'Should contain detective');
  assert.ok(nounWords.includes('mystery'), 'Should lemmatize mysteries -> mystery');
  assert.ok(nounWords.includes('stranger'), 'Should contain stranger');
  assert.ok(nounWords.includes('scientist'), 'Should lemmatize scientists -> scientist');
  assert.ok(nounWords.includes('civilization'), 'Should contain civilization');

  // Verify Verbs:
  const verbWords = analysis.verbs.map(v => v.word);
  assert.ok(verbWords.includes('solve'), 'Should lemmatize solved -> solve');
  assert.ok(verbWords.includes('walk'), 'Should lemmatize walked -> walk');
  assert.ok(verbWords.includes('discover'), 'Should lemmatize discovered -> discover');
  assert.ok(verbWords.includes('run'), 'Should lemmatize running -> run');

  // Check auxiliary verbs are filtered out:
  assert.ok(!verbWords.includes('was'), 'Auxiliary verb "was" must be filtered out');
  assert.ok(!verbWords.includes('be'), 'Auxiliary "be" must be filtered out');

  // Verify Adjectives:
  const adjWords = analysis.adjectives.map(a => a.word);
  assert.ok(adjWords.includes('brilliant'), 'Should contain brilliant');
  assert.ok(adjWords.includes('complicated'), 'Should contain complicated');
  assert.ok(adjWords.includes('mysterious'), 'Should contain mysterious');
  assert.ok(adjWords.includes('beautiful'), 'Should contain beautiful');
  assert.ok(adjWords.includes('ancient'), 'Should contain ancient');

  // Verify Adverbs:
  const advWords = analysis.adverbs.map(adv => adv.word);
  assert.ok(advWords.includes('quickly'), 'Should contain quickly');
  assert.ok(advWords.includes('silently'), 'Should contain silently');
  assert.ok(advWords.includes('fast'), 'Should contain fast');
  assert.ok(advWords.includes('extraordinarily'), 'Should contain extraordinarily');

  // Verify Context Sentences & Timestamps:
  const detectiveItem = analysis.nouns.find(n => n.word === 'detective');
  assert.ok(detectiveItem.contexts.length > 0);
  assert.ok(detectiveItem.contexts[0].startTime.includes('12'));
  assert.strictEqual(detectiveItem.contexts[0].startSec, 12.5);
  assert.ok(detectiveItem.contexts[0].sentence.includes('brilliant detective'));
});

// -------------------------------------------------------------
// Test 8: Anki & CSV Export Formats (Special Char & Delimiter Safety)
// -------------------------------------------------------------
runTest('Anki & CSV Export Formats with Delimiter Safety', () => {
  const mockWords = [
    {
      word: 'detective',
      pos: 'noun',
      posLabelVi: 'Danh từ',
      cefr: 'B1',
      ipa: '/dɪˈtektɪv/',
      translation: 'thám tử, trinh thám',
      frequency: 3,
      contexts: [
        { sentence: 'The brilliant [detective] solved the case with $100 & "evidence".', startTime: '01:23', startSec: 83 }
      ]
    },
    {
      word: 'quickly',
      pos: 'adverb',
      posLabelVi: 'Trạng từ',
      cefr: 'A1',
      ipa: '/ˈkwɪkli/',
      translation: 'nhanh chóng\thợp lệ',
      frequency: 2,
      contexts: [
        { sentence: 'He moved quickly\nacross the room.', startTime: '02:45', startSec: 165 }
      ]
    }
  ];

  const ankiOutput = VocabAnalyzer.exportToAnkiFormat(mockWords);
  assert.ok(ankiOutput.includes('#separator:Tab'), 'Anki format header');
  assert.ok(ankiOutput.includes('#html:true'), 'Anki html header');
  assert.ok(ankiOutput.includes('/dɪˈtektɪv/'), 'Anki includes IPA');
  assert.ok(ankiOutput.includes('thám tử, trinh thám'), 'Anki includes Vietnamese translation');

  // Verify each card line in Anki has exactly 1 tab separator
  const cardLines = ankiOutput.split('\n').filter(l => !l.startsWith('#') && l.trim());
  cardLines.forEach((cardLine) => {
    const tabs = cardLine.split('\t');
    assert.strictEqual(tabs.length, 2, 'Each Anki card must have exactly front and back separated by 1 Tab');
  });

  const csvOutput = VocabAnalyzer.exportToCsvFormat(mockWords);
  assert.ok(csvOutput.includes('"Từ vựng"'), 'CSV header includes Vietnamese column');
  assert.ok(csvOutput.includes('"detective","Danh từ"'));
});

// -------------------------------------------------------------
// Test 9: Manifest V3 Permissions & Resource Integrity
// -------------------------------------------------------------
runTest('Manifest V3 validation', () => {
  const manifestPath = path.join(__dirname, '../manifest.json');
  const manifestRaw = fs.readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestRaw);

  assert.strictEqual(manifest.manifest_version, 3);
  assert.ok(manifest.host_permissions.some(h => h.includes('netflix.com')));
  assert.ok(manifest.host_permissions.some(h => h.includes('youtube.com')));
  assert.ok(manifest.host_permissions.some(h => h.includes('nflxvideo.net')));

  assert.ok(manifest.content_scripts.some(cs => cs.matches.some(m => m.includes('netflix.com'))));
  assert.ok(manifest.content_scripts.some(cs => cs.matches.some(m => m.includes('youtube.com'))));

  // Check declared web_accessible_resources
  const war = manifest.web_accessible_resources[0].resources;
  assert.ok(war.includes('content/netflixInjected.js'));
  assert.ok(war.includes('content/youtubeInjected.js'));
  assert.ok(war.includes('lib/compromise.js'));

  // Ensure all declared files physically exist
  war.forEach((resourcePath) => {
    if (resourcePath.includes('*')) {
      const dirPath = path.join(__dirname, '..', resourcePath.replace('/*', ''));
      assert.ok(fs.existsSync(dirPath), `Declared directory must exist: ${dirPath}`);
    } else {
      const fullPath = path.join(__dirname, '..', resourcePath);
      assert.ok(fs.existsSync(fullPath), `Declared web resource must exist: ${resourcePath}`);
    }
  });
});

// -------------------------------------------------------------
// Test 10: Empty, Malformed and Edge-case Inputs
// -------------------------------------------------------------
runTest('Edge-case & empty input handling', () => {
  assert.deepStrictEqual(SubtitleParser.parse(''), []);
  assert.deepStrictEqual(SubtitleParser.parse(null), []);
  assert.strictEqual(SubtitleParser.toSRT([]), '');
  assert.strictEqual(SubtitleParser.toWebVTT([]), 'WEBVTT\n\n');
  assert.strictEqual(SubtitleParser.toReadableTranscript([]), '');

  const emptyAnalysis = VocabAnalyzer.analyzeSubtitles([]);
  assert.strictEqual(emptyAnalysis.summary.totalWords, 0);
  assert.strictEqual(emptyAnalysis.nouns.length, 0);
  assert.strictEqual(emptyAnalysis.allWords.length, 0);

  assert.strictEqual(VocabAnalyzer.exportToAnkiFormat([]), '');
  assert.strictEqual(VocabAnalyzer.exportToCsvFormat([]), '');
  assert.strictEqual(CefrDict.lookup(''), null);
  assert.strictEqual(CefrDict.lookup(null), null);
});

console.log(`\n====================================================`);
console.log(`🎉 ALL ${testsPassed}/${testsTotal} TESTS PASSED SUCCESSFULLY!`);
console.log(`====================================================\n`);
