"""Deterministic mock of a retailer's ERP tables, for development and demos.

The tables are deliberately **not** in the canonical shape: ``adapters/mock/*.sql`` maps them to the BrickFill
contract exactly as a real retailer's adapter would (title fallbacks, a Y/N mandatory flag, an item status, codes
stored as numbers). Brands are fictional and GTINs use the GS1 restricted-circulation prefix 2, so mock items never
match a real product.

Everything is generated from a seed, so two runs produce identical data. Pure Python on purpose: no Spark is needed
to test the generator.
"""

from __future__ import annotations

import random
from dataclasses import dataclass

Columns = list[tuple[str, str]]  # (name, type): string | int | bigint | boolean

# --- Variant dimensions: "code in the ERP short title | text in the long title" ------------------------------------
_DIMENSIONS: dict[str, list[str]] = {
    "voltage": ["110V|110 V", "220V|220 V", "DUAL|Dual Voltage"],
    "color": [
        "WHT|White",
        "BLK|Black",
        "BLU|Blue",
        "RED|Red",
        "GRN|Green",
        "GRY|Gray",
        "PNK|Pink",
        "YLW|Yellow",
        "ORG|Orange",
        "SLV|Silver",
    ],
    "apparel_size": ["S|S", "M|M", "L|L", "XL|XL"],
    "shoe_size": [f"{n}|{n}" for n in range(36, 46)],
    "weight": ["100G|100 g", "250G|250 g", "500G|500 g", "1KG|1 kg", "2KG|2 kg", "5KG|5 kg"],
    "volume": ["250ML|250 mL", "500ML|500 mL", "1L|1 L", "2L|2 L"],
    "power": ["500W|500 W", "750W|750 W", "1000W|1000 W", "1500W|1500 W", "2000W|2000 W"],
    "pack": ["6PK|6-Pack", "12PK|12-Pack", "24PK|24-Pack"],
    "capacity": ["10L|10 L", "20L|20 L", "30L|30 L"],
    "screen": ['32"|32 in', '43"|43 in', '50"|50 in', '55"|55 in'],
    "storage": ["64GB|64 GB", "128GB|128 GB", "256GB|256 GB"],
    "size_mm": ["6MM|6 mm", "8MM|8 mm", "10MM|10 mm", "12MM|12 mm"],
    "flavor": [
        "CHOC|Chocolate",
        "STRAW|Strawberry",
        "VAN|Vanilla",
        "LEM|Lemon",
        "ORIG|Original",
        "MINT|Mint",
        "CARAM|Caramel",
    ],
    "pet_size": ["SM|Small Breeds", "MD|Medium Breeds", "LG|Large Breeds"],
}


@dataclass(frozen=True)
class _Subcategory:
    department: str
    category: str
    name: str
    weight: int  # share of the generated products
    product_types: tuple[str, ...]  # "Full name|ERP ABBREVIATION"
    brands: tuple[str, ...]
    dimensions: tuple[str, ...]
    has_model: bool


_SUBCATEGORIES: tuple[_Subcategory, ...] = (
    _Subcategory("Home Improvement", "Power Tools", "Drills", 6,
                 ("Impact Drill|IMPACT DRILL", "Cordless Drill Driver|CORDLESS DRILL"),
                 ("Ironclad", "Voltix", "Forgewell"), ("voltage", "power"), True),
    _Subcategory("Home Improvement", "Power Tools", "Saws", 4,
                 ("Circular Saw|CIRC SAW", "Jigsaw|JIGSAW", "Angle Grinder|ANGLE GRINDER"),
                 ("Ironclad", "Voltix", "Brickton"), ("voltage", "power"), True),
    _Subcategory("Home Improvement", "Hardware", "Locks and Padlocks", 3,
                 ("Brass Padlock|PADLOCK BRASS", "Combination Lock|COMB LOCK", "Door Lock|DOOR LOCK"),
                 ("Keystone", "Lockhart"), ("size_mm", "color"), True),
    _Subcategory("Kitchen", "Small Appliances", "Blenders", 5,
                 ("Countertop Blender|BLENDER", "Hand Blender|HAND BLENDER"),
                 ("Cuisora", "Ovenly", "Mixwell"), ("voltage", "power", "color"), True),
    _Subcategory("Kitchen", "Small Appliances", "Coffee Makers", 4,
                 ("Drip Coffee Maker|COFFEE MAKER", "Espresso Machine|ESPRESSO MACH"),
                 ("Cuisora", "Brewster"), ("voltage", "color"), True),
    _Subcategory("Kitchen", "Cookware", "Pans", 4,
                 ("Nonstick Frying Pan|FRYING PAN NS", "Stainless Saucepan|SAUCEPAN SS"),
                 ("Ovenly", "Steelcraft"), ("size_mm", "color"), False),
    _Subcategory("Grocery", "Snacks", "Cookies", 6,
                 ("Chocolate Chip Cookies|COOKIES CHOC CHIP", "Filled Cookies|COOKIES FILLED"),
                 ("Crumbly", "Goldbake"), ("flavor", "weight"), False),
    _Subcategory("Grocery", "Beverages", "Juices", 5,
                 ("Fruit Juice|JUICE", "Sparkling Water|SPARK WATER"),
                 ("Orchardia", "Fizzwell"), ("flavor", "volume", "pack"), False),
    _Subcategory("Grocery", "Pantry", "Coffee", 4,
                 ("Ground Coffee|COFFEE GROUND", "Coffee Beans|COFFEE BEANS"),
                 ("Brewster", "Highland Roast"), ("weight",), False),
    _Subcategory("Personal Care", "Hair Care", "Shampoo", 5,
                 ("Shampoo|SHAMPOO", "Conditioner|CONDITIONER"),
                 ("Silkara", "Purely"), ("volume",), False),
    _Subcategory("Personal Care", "Hair Care", "Hair Dryers", 3,
                 ("Hair Dryer|HAIR DRYER", "Flat Iron|FLAT IRON"),
                 ("Silkara", "Aerostyle"), ("voltage", "power", "color"), True),
    _Subcategory("Personal Care", "Oral Care", "Toothpaste", 4,
                 ("Whitening Toothpaste|TOOTHPASTE WHT", "Sensitive Toothpaste|TOOTHPASTE SENS"),
                 ("Brightly", "Purely"), ("weight", "flavor"), False),
    _Subcategory("Pets", "Dog Food", "Dry Dog Food", 5,
                 ("Adult Dry Dog Food|DOG FOOD ADULT", "Puppy Dry Dog Food|DOG FOOD PUPPY"),
                 ("Pawsome", "Barkley"), ("weight", "pet_size", "flavor"), False),
    _Subcategory("Pets", "Cat Food", "Wet Cat Food", 3,
                 ("Wet Cat Food Pouch|CAT FOOD POUCH",),
                 ("Whiskerly", "Pawsome"), ("weight", "flavor"), False),
    _Subcategory("Electronics", "TV and Video", "Televisions", 4,
                 ("Smart TV LED|SMART TV LED", "Smart TV QLED|SMART TV QLED"),
                 ("Lumora", "Vistek"), ("screen",), True),
    _Subcategory("Electronics", "Phones", "Smartphones", 5,
                 ("Smartphone|SMARTPHONE",),
                 ("Vistek", "Novaphone"), ("storage", "color"), True),
    _Subcategory("Electronics", "Audio", "Headphones", 4,
                 ("Wireless Headphones|HEADPHONES BT", "Earbuds|EARBUDS"),
                 ("Sonique", "Vistek"), ("color",), True),
    _Subcategory("Apparel", "Men's Clothing", "T-Shirts", 5,
                 ("Basic T-Shirt|T-SHIRT BASIC", "Printed T-Shirt|T-SHIRT PRINT"),
                 ("Northline", "Basico"), ("apparel_size", "color"), False),
    _Subcategory("Apparel", "Footwear", "Sneakers", 4,
                 ("Running Sneaker|SNEAKER RUN", "Casual Sneaker|SNEAKER CASUAL"),
                 ("Stridex", "Northline"), ("shoe_size", "color"), True),
    _Subcategory("Home", "Cleaning", "Detergents", 4,
                 ("Liquid Laundry Detergent|DETERGENT LIQ", "Dish Soap|DISH SOAP"),
                 ("Sparkle", "Cleanova"), ("volume", "pack"), False),
    _Subcategory("Home", "Storage", "Storage Boxes", 3,
                 ("Plastic Storage Box|STORAGE BOX", "Organizer Basket|ORGANIZER BASKET"),
                 ("Stackwise", "Homely"), ("capacity", "color"), False),
)  # fmt: skip


@dataclass(frozen=True)
class _Attribute:
    code: int
    name: str
    unit: str
    value_type: str
    role: str
    options: tuple[str, ...]  # empty: free text


def _numbers(values: list[float | int]) -> list[str]:
    return [f"{value:g}" for value in values]


_BRANDS = sorted({brand for spec in _SUBCATEGORIES for brand in spec.brands})
_COLORS = [item.split("|")[1] for item in _DIMENSIONS["color"]] + [
    "Navy Blue",
    "Beige",
    "Brown",
    "Gold",
    "Purple",
    "Graphite",
    "Transparent",
    "Multicolor",
]
_FLAVORS = [item.split("|")[1] for item in _DIMENSIONS["flavor"]] + ["Mixed Berries", "Peanut", "Chicken", "Beef"]

# (name, unit, value_type, role, options); attributes with no options are free text.
_ATTRIBUTE_SPECS: list[tuple[str, str, str, str, list[str]]] = [
    ("Brand", "", "text", "brand", _BRANDS),
    ("Model", "", "text", "model", []),
    ("Color", "", "text", "color", _COLORS),
    ("Warranty", "", "text", "other", ["No warranty", "90 days", "6 months", "1 year", "2 years", "3 years"]),
    ("Country of Origin", "", "text", "other", ["Domestic", "Imported"]),
    ("Product Type", "", "text", "other", []),
    ("Package Quantity", "units", "number", "other", _numbers([1, 2, 3, 4, 6, 8, 10, 12, 24, 48])),
    ("Voltage", "", "text", "other", ["110 V", "127 V", "220 V", "Dual Voltage", "Battery"]),
    ("Power", "W", "number", "other", _numbers([20, 60, 100, 300, 500, 750, 900, 1000, 1200, 1500, 2000, 2200])),
    ("Weight", "g", "number", "other", _numbers([50, 100, 150, 200, 250, 400, 500, 1000, 2000, 5000, 10000])),
    ("Volume", "mL", "number", "other", _numbers([200, 250, 300, 350, 500, 750, 1000, 2000])),
    ("Capacity", "L", "number", "other", _numbers([0.5, 1, 1.5, 2, 5, 10, 20, 30, 50])),
    ("Size", "mm", "number", "other", _numbers([4, 6, 8, 10, 12, 16, 20, 24, 28, 30, 32])),
    ("Screen Size", "in", "number", "other", _numbers([32, 40, 43, 50, 55, 65, 75])),
    ("Storage", "", "text", "other", ["64 GB", "128 GB", "256 GB", "512 GB", "1 TB"]),
    ("Connectivity", "", "text", "other", ["Bluetooth", "Wi-Fi", "USB", "Wi-Fi and Bluetooth", "Wired"]),
    ("Material", "", "text", "other", ["Stainless Steel", "Aluminum", "Plastic", "Glass", "Cotton", "Polyester"]),
    ("Flavor", "", "text", "other", _FLAVORS),
    ("Pet Size", "", "text", "size", ["Small", "Medium", "Large", "All Sizes"]),
    ("Life Stage", "", "text", "other", ["Puppy", "Kitten", "Adult", "Senior"]),
    ("Apparel Size", "", "text", "size", ["XS", "S", "M", "L", "XL", "XXL"]),
    ("Shoe Size", "", "text", "size", [str(n) for n in range(34, 48)]),
    ("Gender", "", "text", "other", ["Men", "Women", "Unisex", "Kids"]),
    ("Hair Type", "", "text", "other", ["Normal", "Dry", "Oily", "Curly", "Color-Treated"]),
    ("Ingredients", "", "text", "other", []),
    ("Gluten Free", "", "boolean", "other", ["Yes", "No"]),
    ("Shelf Life", "", "text", "other", ["6 months", "12 months", "18 months", "24 months"]),
    ("Dimensions (HxWxD)", "", "text", "other", []),
    ("Department", "", "text", "taxonomy", []),
]

_COMMON = ["Brand", "Model", "Color", "Warranty", "Country of Origin", "Product Type", "Package Quantity"]
_BY_DEPARTMENT: dict[str, list[str]] = {
    "Home Improvement": ["Voltage", "Power", "Weight", "Size", "Material", "Dimensions (HxWxD)"],
    "Kitchen": ["Voltage", "Power", "Capacity", "Material", "Dimensions (HxWxD)"],
    "Grocery": ["Flavor", "Weight", "Volume", "Ingredients", "Gluten Free", "Shelf Life"],
    "Personal Care": ["Volume", "Weight", "Hair Type", "Voltage", "Power", "Ingredients"],
    "Pets": ["Weight", "Pet Size", "Life Stage", "Flavor", "Ingredients"],
    "Electronics": ["Screen Size", "Storage", "Connectivity", "Voltage", "Dimensions (HxWxD)"],
    "Apparel": ["Apparel Size", "Shoe Size", "Gender", "Material"],
    "Home": ["Volume", "Capacity", "Material", "Dimensions (HxWxD)"],
}


def _check_digit(digits: str) -> str:
    """GS1 check digit for the payload (a GTIN without its last digit)."""
    total = sum(int(char) * (3 if index % 2 == 0 else 1) for index, char in enumerate(reversed(digits)))
    return str((10 - total % 10) % 10)


def gtin13(body12: str) -> str:
    return body12 + _check_digit(body12)


def gtin14(ean13: str, indicator: str = "1") -> str:
    """Logistic unit (GTIN-14) built from a 13-digit GTIN."""
    body = indicator + ean13[:12]
    return body + _check_digit(body)


def _model_code(rng: random.Random) -> str:
    letters = "".join(rng.choice("ABCDEFGHJKLMNPRSTVXZ") for _ in range(rng.choice((2, 3))))
    return f"{letters}{rng.choice((10, 100, 1000)) * rng.randint(1, 9) + rng.randint(0, 99)}"


TABLES: dict[str, Columns] = {
    "erp_department": [("department_code", "int"), ("department_name", "string")],
    "erp_category": [("category_code", "int"), ("category_name", "string"), ("department_code", "int")],
    "erp_subcategory": [("subcategory_code", "int"), ("subcategory_name", "string"), ("category_code", "int")],
    "erp_item": [
        ("item_code", "bigint"),
        ("gtin", "string"),
        ("subcategory_code", "int"),
        ("brand_name", "string"),
        ("supplier_name", "string"),
        ("status", "string"),
    ],
    "erp_item_text": [("item_code", "bigint"), ("short_title", "string"), ("long_title", "string")],
    "erp_attribute": [
        ("attribute_code", "int"),
        ("attribute_name", "string"),
        ("unit", "string"),
        ("value_type", "string"),
        ("role", "string"),
    ],
    "erp_attribute_scope": [("attribute_code", "int"), ("subcategory_code", "int"), ("mandatory_flag", "string")],
    "erp_attribute_option": [("attribute_code", "int"), ("option_code", "int"), ("option_text", "string")],
}


def generate(product_count: int = 20_000, seed: int = 20260101) -> dict[str, tuple[Columns, list[tuple]]]:
    """Return ``{table_name: (columns, rows)}`` for the mock ERP tables."""
    if product_count < 1:
        raise ValueError("product_count must be positive")
    rng = random.Random(seed)

    attributes = {
        name: _Attribute(index, name, unit, value_type, role, tuple(dict.fromkeys(options)))
        for index, (name, unit, value_type, role, options) in enumerate(_ATTRIBUTE_SPECS, start=1)
    }
    departments: dict[str, int] = {}
    categories: dict[tuple[str, str], int] = {}
    subcategories: list[tuple[int, _Subcategory]] = []
    for spec in _SUBCATEGORIES:
        departments.setdefault(spec.department, 10 * (len(departments) + 1))
        categories.setdefault((spec.department, spec.category), 100 + len(categories) + 1)
        subcategories.append((1000 + len(subcategories) + 1, spec))

    scope_rows: list[tuple] = []
    for sub_code, spec in subcategories:
        for name in dict.fromkeys(_COMMON + _BY_DEPARTMENT[spec.department]):
            mandatory = "Y" if name in _COMMON[:3] else rng.choice(("Y", "N", "N"))
            scope_rows.append((attributes[name].code, sub_code, mandatory))

    option_rows: list[tuple] = []
    option_code = 1
    for attribute in attributes.values():
        for text in attribute.options:
            option_rows.append((attribute.code, option_code, text))
            option_code += 1

    weights = [spec.weight for _code, spec in subcategories]
    items: list[tuple] = []
    texts: list[tuple] = []
    used_gtins: set[str] = set()
    item_code = 500_000
    for _ in range(product_count):
        sub_code, spec = rng.choices(subcategories, weights=weights)[0]
        full_type, short_type = rng.choice(spec.product_types).split("|")
        brand = rng.choice(spec.brands)
        picked = [
            rng.choice(_DIMENSIONS[name]).split("|")
            for name in rng.sample(list(spec.dimensions), min(len(spec.dimensions), rng.choice((1, 2))))
        ]
        model = _model_code(rng) if spec.has_model else ""
        short_title = " ".join(part for part in (short_type, brand.upper(), model, *(i[0] for i in picked)) if part)
        long_title = " ".join(part for part in (full_type, brand, model, *(i[1] for i in picked)) if part)

        while True:
            # GS1 prefix 2xx: restricted circulation, never assigned to a real trade item
            gtin = gtin13("2" + "".join(str(rng.randint(0, 9)) for _ in range(11)))
            if rng.random() < 0.03:
                gtin = gtin14(gtin)
            if gtin not in used_gtins:
                used_gtins.add(gtin)
                break
        item_code += rng.randint(1, 9)
        status = "INACTIVE" if rng.random() < 0.01 else "ACTIVE"
        brand_name = brand if rng.random() >= 0.3 else None  # ~30% have no brand: the agent discovers it
        supplier = f"{brand} Inc." if rng.random() < 0.6 else None
        items.append((item_code, gtin, sub_code, brand_name, supplier, status))
        roll = rng.random()
        if roll < 0.002:  # no title at all: the adapter filters the item out
            continue
        short = short_title[:40] if roll >= 0.03 else None  # ~3% have only the long title
        long = long_title if rng.random() >= 0.12 else None  # ~12% have only the short title
        texts.append((item_code, short, long))

    return {
        "erp_department": (TABLES["erp_department"], [(code, name) for name, code in departments.items()]),
        "erp_category": (
            TABLES["erp_category"],
            [(code, category, departments[department]) for (department, category), code in categories.items()],
        ),
        "erp_subcategory": (
            TABLES["erp_subcategory"],
            [(code, spec.name, categories[(spec.department, spec.category)]) for code, spec in subcategories],
        ),
        "erp_item": (TABLES["erp_item"], items),
        "erp_item_text": (TABLES["erp_item_text"], texts),
        "erp_attribute": (
            TABLES["erp_attribute"],
            [(a.code, a.name, a.unit or None, a.value_type, a.role) for a in attributes.values()],
        ),
        "erp_attribute_scope": (TABLES["erp_attribute_scope"], scope_rows),
        "erp_attribute_option": (TABLES["erp_attribute_option"], option_rows),
    }
