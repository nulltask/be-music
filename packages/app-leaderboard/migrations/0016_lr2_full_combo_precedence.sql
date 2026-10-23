-- LR2 CheckClear awards FULL COMBO before inspecting the gauge. Keep the gauge measurements and other
-- rulesets unchanged; only the derived LR2 lamp and its best-score reference need to be recomputed.
UPDATE `score_result`
SET `clear_lamp` = 7
WHERE `ruleset` = 'lr2'
  AND `note_count` > 0
  AND COALESCE(json_extract(`judges`, '$.pgreat'), 0)
    + COALESCE(json_extract(`judges`, '$.great'), 0)
    + COALESCE(json_extract(`judges`, '$.good'), 0) >= `note_count`;
--> statement-breakpoint
UPDATE `best_score`
SET (`best_lamp`, `best_lamp_score_id`) = (
  SELECT `score_result`.`clear_lamp`, `score`.`id`
  FROM `score`
  INNER JOIN `score_result` ON `score_result`.`score_id` = `score`.`id` AND `score_result`.`ruleset` = `best_score`.`ruleset`
  WHERE `score`.`user_id` = `best_score`.`user_id`
    AND `score`.`chart_fingerprint` = `best_score`.`chart_fingerprint`
    AND `score`.`assisted` = `best_score`.`assisted`
    AND `score`.`hidden` = 0
  ORDER BY `score_result`.`clear_lamp` DESC, `score`.`created_at` ASC, `score`.`id` ASC
  LIMIT 1
)
WHERE `ruleset` = 'lr2';
