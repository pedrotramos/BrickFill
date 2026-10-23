SELECT gtin::text AS ean,
       product_id::text AS product_id,
       TRIM(title) AS source_title,
       NULLIF(TRIM(brand), '') AS source_brand,
       department_id::text AS department_id,
       TRIM(department) AS department,
       category_id::text AS category_id,
       TRIM(category) AS category,
       subcategory_id::text AS subcategory_id,
       TRIM(subcategory) AS subcategory
FROM {{serving}}.products
WHERE gtin IS NOT NULL
  AND NULLIF(TRIM(title), '') IS NOT NULL
  AND COALESCE(is_active, TRUE)
