import { useState } from 'react';
import DrinkButton from '../../components/DrinkButton.tsx';
import { Choice, Editor, ListRow, NumberField, TextField, Toggle } from '../../components/form.tsx';
import { numberText, parseNumber } from '../../lib/number.ts';
import { bahtInput, formatTHB, parseBaht } from '../../lib/money.ts';
import { unitLabel } from '../../lib/quantity.ts';
import { grossMarginPct, lineCost, unitPrice, type CostCatalog } from '../../domain/cost.ts';
import {
  addBomRow,
  createProduct,
  createVariant,
  removeBomRow,
  saveBomRow,
  saveProduct,
  saveVariant,
} from '../../db/catalog-repo.ts';
import type { Bom, Product, ProductKind, Temp, Variant } from '../../db/types.ts';
import { AddButton, Saved } from './shared.tsx';
import { problemsOf } from './problems.ts';

type View =
  | { kind: 'LIST' }
  | { kind: 'NEW' }
  | { kind: 'PRODUCT'; id: string }
  | { kind: 'VARIANT'; id: string };

const KINDS = [
  ['DRINK', 'เครื่องดื่ม'],
  ['BOTTLE', 'ขวด'],
] as const;

/**
 * The menu: products, their variants, and each variant's recipe (CLAUDE.md
 * §2.1.1 — the BOM is per variant, never per product). A third drink is added
 * here and nowhere else.
 */
export default function MenuSettings({ catalog }: { catalog: CostCatalog }) {
  const [view, setView] = useState<View>({ kind: 'LIST' });

  if (view.kind === 'NEW') {
    return (
      <NewProductForm
        catalog={catalog}
        onBack={() => setView({ kind: 'LIST' })}
        onCreated={(id) => setView({ kind: 'PRODUCT', id })}
      />
    );
  }

  if (view.kind === 'PRODUCT') {
    const product = catalog.products.get(view.id);
    if (!product) return null;
    return (
      <ProductEditor
        key={product.id}
        catalog={catalog}
        product={product}
        onBack={() => setView({ kind: 'LIST' })}
        onOpenVariant={(id) => setView({ kind: 'VARIANT', id })}
      />
    );
  }

  if (view.kind === 'VARIANT') {
    const variant = catalog.variants.get(view.id);
    if (!variant) return null;
    return (
      <VariantEditor
        key={variant.id}
        catalog={catalog}
        variant={variant}
        onBack={() => setView({ kind: 'PRODUCT', id: variant.product_id })}
      />
    );
  }

  const products = [...catalog.products.values()].sort((a, b) => a.sort_order - b.sort_order);

  return (
    <section aria-label="เมนู">
      <ul>
        {products.map((product) => (
          <ListRow
            key={product.id}
            title={product.name_short_th}
            detail={formatTHB(product.base_price)}
            muted={!product.is_active}
            onOpen={() => setView({ kind: 'PRODUCT', id: product.id })}
          />
        ))}
      </ul>
      <AddButton label="เพิ่มเมนู" onClick={() => setView({ kind: 'NEW' })} />
    </section>
  );
}

// -------------------------------------------------------------- new product

function NewProductForm({
  catalog,
  onBack,
  onCreated,
}: {
  catalog: CostCatalog;
  onBack: () => void;
  onCreated: (productId: string) => void;
}) {
  const sets = [...catalog.packagingSets.values()];
  const [shortName, setShortName] = useState('');
  const [fullName, setFullName] = useState('');
  const [price, setPrice] = useState('');
  const [kind, setKind] = useState<ProductKind>('DRINK');
  const [packaging, setPackaging] = useState(sets[0]?.id ?? '');
  const [problems, setProblems] = useState<string[]>([]);

  function save() {
    const basePrice = parseBaht(price);
    if (basePrice === null) {
      setProblems(['ราคาต้องเป็นตัวเลข']);
      return;
    }
    createProduct({
      name_short_th: shortName,
      name_full_th: fullName,
      base_price: basePrice,
      kind,
      packaging_set_id: packaging,
    })
      .then(({ product }) => onCreated(product.id))
      .catch((cause: unknown) => setProblems(problemsOf(cause)));
  }

  return (
    <Editor title="เมนูใหม่" problems={problems} onSave={save} onBack={onBack}>
      <TextField
        label="ชื่อสั้น (บนปุ่ม)"
        value={shortName}
        onChange={setShortName}
        hint="ที่ขึ้นบนปุ่ม ตะกร้า ใบเสร็จ และรายงาน"
      />
      <TextField label="ชื่อเต็ม (ป้ายเมนู)" value={fullName} onChange={setFullName} />
      <NumberField label="ราคา" value={price} onChange={setPrice} suffix="บาท" />
      <Choice label="ประเภท" value={kind} options={KINDS} onChange={setKind} />
      <Choice
        label="บรรจุภัณฑ์"
        value={packaging}
        options={sets.map((set) => [set.id, set.name] as const)}
        onChange={setPackaging}
      />
    </Editor>
  );
}

// ------------------------------------------------------------------ product

function ProductEditor({
  catalog,
  product,
  onBack,
  onOpenVariant,
}: {
  catalog: CostCatalog;
  product: Product;
  onBack: () => void;
  onOpenVariant: (variantId: string) => void;
}) {
  const [shortName, setShortName] = useState(product.name_short_th);
  const [fullName, setFullName] = useState(product.name_full_th);
  const [nameEn, setNameEn] = useState(product.name_en);
  const [price, setPrice] = useState(bahtInput(product.base_price));
  const [kind, setKind] = useState<ProductKind>(product.kind);
  const [advisory, setAdvisory] = useState(product.advisory_th ?? '');
  const [active, setActive] = useState(product.is_active);
  const [sortOrder, setSortOrder] = useState(String(product.sort_order));
  const [problems, setProblems] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);

  const variants = [...catalog.variants.values()]
    .filter((variant) => variant.product_id === product.id)
    .sort((a, b) => a.sort_order - b.sort_order);
  const previewPrice = parseBaht(price) ?? product.base_price;

  function save() {
    const basePrice = parseBaht(price);
    const sort = parseNumber(sortOrder);
    if (basePrice === null || sort === null) {
      setProblems(['ราคาและลำดับต้องเป็นตัวเลข']);
      return;
    }
    saveProduct({
      ...product,
      name_short_th: shortName.trim(),
      name_full_th: fullName.trim(),
      name_en: nameEn.trim(),
      base_price: basePrice,
      kind,
      advisory_th: advisory.trim() || null,
      is_active: active,
      sort_order: sort,
    })
      .then(() => {
        setProblems([]);
        setSaved(true);
      })
      .catch((cause: unknown) => setProblems(problemsOf(cause)));
  }

  return (
    <Editor title={product.name_short_th} problems={problems} onSave={save} onBack={onBack}>
      {/* What the operator will actually see. A name that does not fit is the
          wrong name — it is never truncated (CLAUDE.md §9). */}
      <p className="mt-3 text-lg font-bold">ตัวอย่างปุ่ม</p>
      <div className="mt-1 w-[48%]">
        <DrinkButton
          product={{ ...product, name_short_th: shortName || '—' }}
          price={previewPrice}
          cups={Infinity}
          limitingComponentName={null}
          colorVar={kind === 'BOTTLE' ? '--color-bottle' : '--color-drink-1'}
          onTap={() => {}}
        />
      </div>

      <TextField label="ชื่อสั้น (บนปุ่ม)" value={shortName} onChange={setShortName} />
      <TextField label="ชื่อเต็ม (ป้ายเมนู)" value={fullName} onChange={setFullName} />
      <TextField label="ชื่ออังกฤษ" value={nameEn} onChange={setNameEn} />
      <NumberField label="ราคา" value={price} onChange={setPrice} suffix="บาท" />
      <Choice label="ประเภท" value={kind} options={KINDS} onChange={setKind} />
      <TextField
        label="คำเตือน"
        value={advisory}
        onChange={setAdvisory}
        multiline
        hint="แสดงตอนขาย เช่น มีคาเฟอีน · สตรีมีครรภ์แนะนำเลี่ยง"
      />
      <Toggle label="ขายอยู่" value={active} onChange={setActive} />
      <NumberField label="ลำดับบนหน้าขาย" value={sortOrder} onChange={setSortOrder} />
      <Saved show={saved} />

      <h3 className="mt-6 text-xl font-bold">แบบและสูตร</h3>
      <ul>
        {variants.map((variant) => (
          <ListRow
            key={variant.id}
            title={variant.name_th}
            detail={`${formatTHB(unitPrice(catalog, variant.id))}${variant.is_default ? ' · ค่าเริ่มต้น' : ''}`}
            muted={!variant.is_active}
            onOpen={() => onOpenVariant(variant.id)}
          />
        ))}
      </ul>
      <AddButton
        label="เพิ่มแบบ (เช่น ร้อน)"
        onClick={() => {
          createVariant(product.id)
            .then((variant) => onOpenVariant(variant.id))
            .catch((cause: unknown) => setProblems(problemsOf(cause)));
        }}
      />
    </Editor>
  );
}

// ------------------------------------------------------------------ variant

const TEMPS = [
  ['ICED', 'เย็น'],
  ['HOT', 'ร้อน'],
  ['NONE', 'ไม่มี'],
] as const;

function VariantEditor({
  catalog,
  variant,
  onBack,
}: {
  catalog: CostCatalog;
  variant: Variant;
  onBack: () => void;
}) {
  const [name, setName] = useState(variant.name_th);
  const [temp, setTemp] = useState<Temp | 'NONE'>(variant.temp ?? 'NONE');
  const [priceOverride, setPriceOverride] = useState(
    variant.price_override === null ? '' : bahtInput(variant.price_override),
  );
  const [packaging, setPackaging] = useState(variant.packaging_set_id);
  const [isDefault, setIsDefault] = useState(variant.is_default);
  const [active, setActive] = useState(variant.is_active);
  const [sortOrder, setSortOrder] = useState(String(variant.sort_order));
  const [problems, setProblems] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);

  const rows = catalog.bomByVariant.get(variant.id) ?? [];
  const price = unitPrice(catalog, variant.id);
  const cost = lineCost(catalog, variant.id);

  function save() {
    const override = priceOverride.trim() === '' ? null : parseBaht(priceOverride);
    const sort = parseNumber(sortOrder);
    if ((priceOverride.trim() !== '' && override === null) || sort === null) {
      setProblems(['ราคาและลำดับต้องเป็นตัวเลข']);
      return;
    }
    saveVariant({
      ...variant,
      name_th: name.trim(),
      temp: temp === 'NONE' ? null : temp,
      price_override: override,
      packaging_set_id: packaging,
      is_default: isDefault,
      is_active: active,
      sort_order: sort,
    })
      .then(() => {
        setProblems([]);
        setSaved(true);
      })
      .catch((cause: unknown) => setProblems(problemsOf(cause)));
  }

  return (
    <Editor title={variant.name_th} problems={problems} onSave={save} onBack={onBack}>
      {/* The number the recipe is for: what a cup costs and what it leaves. */}
      <p
        role="status"
        aria-label="ต้นทุนต่อแก้ว"
        className="bg-paper-sunk mt-3 rounded-xl px-4 py-3 text-lg font-bold"
      >
        ขาย {formatTHB(price)} · ต้นทุน {formatTHB(cost)} · กำไร{' '}
        {price > 0 ? `${Math.round(grossMarginPct(price, cost))}%` : '—'}
      </p>

      <TextField label="ชื่อแบบ" value={name} onChange={setName} />
      <Choice label="อุณหภูมิ" value={temp} options={TEMPS} onChange={setTemp} />
      <NumberField
        label="ราคาเฉพาะแบบนี้"
        value={priceOverride}
        onChange={setPriceOverride}
        suffix="บาท"
        hint="เว้นว่าง = ใช้ราคาของเมนู"
      />
      <Choice
        label="บรรจุภัณฑ์"
        value={packaging}
        options={[...catalog.packagingSets.values()].map((set) => [set.id, set.name] as const)}
        onChange={setPackaging}
      />
      <Toggle label="แบบที่กดแล้วได้เลย" value={isDefault} onChange={setIsDefault} />
      <Toggle label="ขายอยู่" value={active} onChange={setActive} />
      <NumberField label="ลำดับ" value={sortOrder} onChange={setSortOrder} />
      <Saved show={saved} />

      <h3 className="mt-6 text-xl font-bold">สูตรต่อแก้ว</h3>
      <ul aria-label="สูตรต่อแก้ว">
        {rows.map((row) => (
          <BomRowEditor key={row.id} catalog={catalog} row={row} onProblems={setProblems} />
        ))}
      </ul>
      <AddBomRow
        catalog={catalog}
        variantId={variant.id}
        existing={rows}
        onProblems={setProblems}
      />
    </Editor>
  );
}

function BomRowEditor({
  catalog,
  row,
  onProblems,
}: {
  catalog: CostCatalog;
  row: Bom;
  onProblems: (problems: string[]) => void;
}) {
  const component = catalog.components.get(row.component_id);
  const [qty, setQty] = useState(numberText(row.qty_per_cup));
  const changed = qty !== numberText(row.qty_per_cup);

  return (
    <li className="border-line flex items-end gap-2 border-b py-2">
      <div className="min-w-0 flex-1">
        <NumberField
          label={component?.name_th ?? row.component_id}
          value={qty}
          onChange={setQty}
          suffix={component ? unitLabel(component.unit) : ''}
        />
      </div>
      {changed ? (
        <button
          type="button"
          onClick={() => {
            const value = parseNumber(qty);
            if (value === null) return onProblems(['ปริมาณต้องเป็นตัวเลข']);
            saveBomRow({ ...row, qty_per_cup: value })
              .then(() => onProblems([]))
              .catch((cause: unknown) => onProblems(problemsOf(cause)));
          }}
          className="bg-brand-2 min-h-touch rounded-xl px-3 text-lg font-bold text-white"
        >
          บันทึก
        </button>
      ) : null}
      <button
        type="button"
        aria-label={`เอา${component?.name_th ?? ''}ออกจากสูตร`}
        onClick={() => void removeBomRow(row.id)}
        className="border-line min-h-touch rounded-xl border-2 px-3 text-lg font-bold"
      >
        ลบ
      </button>
    </li>
  );
}

function AddBomRow({
  catalog,
  variantId,
  existing,
  onProblems,
}: {
  catalog: CostCatalog;
  variantId: string;
  existing: readonly Bom[];
  onProblems: (problems: string[]) => void;
}) {
  const used = new Set(existing.map((row) => row.component_id));
  const available = [...catalog.components.values()]
    .filter((component) => !used.has(component.id))
    .sort((a, b) => a.sort_order - b.sort_order);
  const [componentId, setComponentId] = useState(available[0]?.id ?? '');
  const [qty, setQty] = useState('');

  if (available.length === 0) return null;
  const component = available.find((entry) => entry.id === componentId) ?? available[0]!;

  return (
    <div className="bg-paper-sunk mt-3 rounded-xl px-3 pb-3">
      <Choice
        label="เพิ่มส่วนประกอบ"
        value={component.id}
        options={available.map((entry) => [entry.id, entry.name_th] as const)}
        onChange={setComponentId}
      />
      <NumberField
        label="ปริมาณต่อแก้ว"
        value={qty}
        onChange={setQty}
        suffix={unitLabel(component.unit)}
      />
      <button
        type="button"
        onClick={() => {
          const value = parseNumber(qty);
          if (value === null) return onProblems(['ปริมาณต้องเป็นตัวเลข']);
          addBomRow(variantId, component.id, value)
            .then(() => {
              onProblems([]);
              setQty('');
            })
            .catch((cause: unknown) => onProblems(problemsOf(cause)));
        }}
        className="bg-ink min-h-touch mt-3 w-full rounded-xl text-lg font-bold text-white"
      >
        เพิ่มในสูตร
      </button>
    </div>
  );
}
