# Electricity prices

Apply `backend/src/db/migrations/017_energy_price_settings.sql` before deploying. Existing accounts remain in **Spot** mode, excluding VAT, taxes, grid tariffs and supplier markup. No API key is needed.

In Dashboard → Energy prices, choose **Estimated consumer price**, then the grid company/household tariff from your bill. Enter your electricity supplier's per-kWh markup **excluding VAT**, in øre/kWh; use zero only if your agreement has no markup. Save and refresh the preview. The estimate includes variable electricity costs; **fixed subscriptions and fees are excluded**. It assumes a standard household spot-price contract and standard electricity tax. Fixed-price contracts, special producer tariffs and individual rebates need different settings and are not inferred.

Presets were checked against live DataHub records and the operators' published household rates on 2026-10-02. Select your actual C category; company name alone is not enough for a special agreement. Presets store identifiers, never frozen rates.

| Household preset | Area | GLN | Required tariff code | Operator prices |
|---|---|---|---|---|
| Radius C | DK2 | 5790000705689 | DT_C_01 | [Radius](https://radiuselnet.dk/priser/) |
| Cerius C | DK2 | 5790000705184 | 30TR_C_ET | [Cerius](https://cerius.dk/priser/alle/) |
| N1 C, grid area 131 | DK1 | 5790001089030 | CD | [N1](https://n1.dk/gaeldende-priser) |
| N1 C, grid area 344 | DK1 | 5790000611003 | T-C-F-T-TD | [N1](https://n1.dk/gaeldende-priser) |
| Dinel C, hourly | DK1 | 5790000610099 | TCL<100_02 | [Dinel](https://dinel.dk/priser-og-bestemmelser/hvad-skal-private-elkunder-betale-i-nettarif/) |

For another plan, select custom and enter its 13-digit GLN and 1–5 unique, additive D03 tariff codes. Include a separate adjustment code only if it applies to the contract. Alternative categories must not be added together. Every configured code is required; an expired or missing adjustment makes the estimate unavailable rather than silently omitting it. The [regulator's household tariff methodology](https://forsyningstilsynet.dk/Media/638536031032121805/Elnetvirksomhedernes%20tariffer%20for%20husholdninger.pdf) explains categories and adjustments.

For each 15-minute interval, calculation in øre/kWh is:

`(spot + selected grid tariffs + national transmission + national system + electricity tax + supplier markup) × 1.25`

National charges come from DatahubPricelist GLN `5790000432752`, codes `40000`, `41000`, `EA-001`, selected by effective date. The 2026 transmission/system rates are 4.3/7.2 øre excluding VAT ([Energinet tariff catalogue](https://energinet.dk/media/5v3pikp3/energinets_tarifkatalog_2026.pdf)). Standard electricity tax is 0.8 øre in 2026–2027 ([Skattestyrelsen](https://skat.dk/erhverv/afgifter-paa-varer-og-ydelser-punktafgifter/nyhedsbrev-afgifter/midlertidig-nedsaettelse-af-elafgiften-i-2026-og-2027)). These rates are fetched, not hardcoded. VAT is the standard 25% ([Skattestyrelsen](https://skat.dk/erhverv/moms/i-gang-med-moms)).

The [official dataset metadata](https://api.energidataservice.dk/meta/dataset/DatahubPricelist) defines Danish local hourly slots and flat-rate/null-slot handling. Validity uses Danish calendar dates, inclusive `ValidFrom` and exclusive `ValidTo`. The API filters on `ValidFrom`; requests therefore omit a recent start and use an unlimited filtered result so older active tariffs survive. Only exact GLN/code matches are accepted. Daily raw tariff caches are scoped to GLN and codes; raw spot caches are scoped to area and expire at the current quarter-hour boundary. A user's markup and tariff combination are calculated separately. Source failures never fall back to spot mode.

The current interval is selected in UTC; hourly tariffs and the average always use Europe/Copenhagen, independently of the display clock. The average is the mean of available interval totals for the Danish day, including 23/25-hour DST days; it is not consumption-weighted. BMP output labels spot exclusions or an estimate including VAT, with fixed fees excluded. Taller widgets also show the average.

The independent `packages/widgets` Energinet widget remains **spot-only**, labelled as such. The dashboard, BMP preview, Bluetooth payload and automatic device feed use the backend consumer calculation.

## API and templates

`POST /api/preferences` accepts the complete `energy_price_settings` object, also included in version-1 display template export/import. Partial nested profiles, extra properties, duplicate/empty codes and non-finite markup are rejected before saving any preference. GLN is a string; codes may include tariff punctuation such as `<` and `>`.

```json
{
  "energy_price_location": "DK2",
  "energy_price_settings": {
    "mode": "consumer",
    "gridGln": "5790000705689",
    "gridChargeCodes": ["DT_C_01"],
    "retailerMarkupOre": 5
  }
}
```

Use `{"mode":"spot"}` to restore spot mode. Consumer JSON results add `"basis":"consumer"`; absence preserves the historical spot meaning. Both `now` and `average` remain in øre/kWh.
