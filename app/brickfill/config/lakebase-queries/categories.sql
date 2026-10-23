SELECT category_id, MIN(category) AS category
FROM ({{products_base}}) p
WHERE category_id IS NOT NULL AND category IS NOT NULL AND category <> ''
GROUP BY category_id
ORDER BY MIN(category), category_id
