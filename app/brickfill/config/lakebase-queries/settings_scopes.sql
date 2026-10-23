-- Department/category/subcategory combinations of the catalog, to check the settings each product would get.
SELECT DISTINCT department_id, category_id, subcategory_id
FROM ({{products_base}}) p
