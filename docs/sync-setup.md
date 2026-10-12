# Online sync — one-time Cloudflare setup

The app's sync server is already in this repository (`functions/api/sync/`) and deploys with every push. It needs one D1 database linked to the Pages project, once.

1. Cloudflare dashboard → **Storage & Databases → D1 SQL Database → Create**. Name it `rudu-sync`. Location: Asia-Pacific if offered.
2. **Workers & Pages → rudu-pos → Settings → Bindings → Add → D1 database.**
   - Variable name: `DB` (exactly, capitals)
   - D1 database: `rudu-sync`
   - Save. Do this for **Production** (and Preview if asked).
3. **Deployments → the latest one → ⋯ → Retry deployment**, so the binding takes effect.
4. Check: open `https://rudu-pos.pages.dev/api/sync/check` in a browser. `{"error":"key"}` means the database is linked and working. `{"error":"no-database"}` means step 2 did not take — check the variable name is `DB`.

The tables are created automatically on first use. No SQL to run.

Then, on the shop phone: **เมนู → ตั้งค่า → ข้อมูล → ซิงค์ออนไลน์ → เปิดซิงค์ออนไลน์**.

There are two codes. The **view code** (รหัสดูยอด) is the one you share: a device with it can only look — the server refuses it anything that writes. The **shop code** (รหัสเครื่องร้าน, behind “แสดงรหัสเครื่องร้าน”) is for moving to a new shop phone only; never send it to anyone.

To look from another device: on the shop phone tap **ส่งลิงก์ให้เครื่องที่จะดู** and open the link there, or type the view code under **ใช้เครื่องนี้ดูยอดร้าน**.

To move to a new shop phone: on the new phone, type the **shop code** and tap **ใช้แทนเครื่องร้านเดิม**.

If a phone with a code is lost: on the shop phone, **เปลี่ยนรหัสร้าน**. Both codes change; every viewer then needs the new view code.
