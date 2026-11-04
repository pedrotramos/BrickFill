-- Department > category > subcategory of the catalog, with the number of products of each subcategory (pickers,
-- Category templates and Attributes screens).
SELECT department_id,
       MIN(department) AS department,
       category_id,
       MIN(category) AS category,
       subcategory_id,
       MIN(subcategory) AS subcategory,
       COUNT(*)::int AS product_count
FROM ({{products_base}}) p
WHERE subcategory_id IS NOT NULL
GROUP BY department_id, category_id, subcategory_id
ORDER BY MIN(department), MIN(category), MIN(subcategory), subcategory_id
