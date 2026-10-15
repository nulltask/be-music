-- LR2 ruleset figures follow LR2: BP leaves empty POORs out (OpenLR2 LR2f.cpp L9649-L9657), and a DEATH-gauge clear is a
-- NORMAL clear (L2593-L2600). Rewrite the stored LR2 results, then re-pick each LR2 best lamp and fewest-miss play the
-- way the bests fold plays: the first shown play, in accepted order, to reach the best value.
UPDATE `score_result`
SET `miss_count` = `miss_count` - coalesce(json_extract(`judges`, '$.emptyPoor'), 0)
WHERE `ruleset` = 'lr2';
--> statement-breakpoint
UPDATE `score_result` SET `clear_lamp` = 4 WHERE `ruleset` = 'lr2' AND `gauge_type` = 'DEATH' AND `clear_lamp` = 6;
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
--> statement-breakpoint
UPDATE `best_score`
SET (`min_miss`, `min_miss_score_id`) = (
  SELECT `score_result`.`miss_count`, `score`.`id`
  FROM `score`
  INNER JOIN `score_result` ON `score_result`.`score_id` = `score`.`id` AND `score_result`.`ruleset` = `best_score`.`ruleset`
  WHERE `score`.`user_id` = `best_score`.`user_id`
    AND `score`.`chart_fingerprint` = `best_score`.`chart_fingerprint`
    AND `score`.`assisted` = `best_score`.`assisted`
    AND `score`.`hidden` = 0
  ORDER BY `score_result`.`miss_count` ASC, `score`.`created_at` ASC, `score`.`id` ASC
  LIMIT 1
)
WHERE `ruleset` = 'lr2';
