import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { expect, test } from 'vite-plus/test';

test('migration 0015 renames chart and course replay references without changing their values', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(
      "CREATE TABLE score (id TEXT PRIMARY KEY, playlog_key TEXT NOT NULL); INSERT INTO score VALUES ('play', 'object/play');",
    );
    db.exec(
      "CREATE TABLE course_score (id TEXT PRIMARY KEY, playlog_key TEXT NOT NULL); INSERT INTO course_score VALUES ('course', 'object/course');",
    );
    db.exec(readFileSync(new URL('../migrations/0015_replay_terminology.sql', import.meta.url), 'utf8'));
    expect(db.prepare('SELECT id, replay_key FROM score').get()).toMatchObject({
      id: 'play',
      replay_key: 'object/play',
    });
    expect(db.prepare('SELECT id, replay_key FROM course_score').get()).toMatchObject({
      id: 'course',
      replay_key: 'object/course',
    });
  } finally {
    db.close();
  }
});
