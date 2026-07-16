/**
 * Column/row editor presented as a modal from Mali Tablo, so closing returns
 * to the table instead of diving into the Settings tab. It reuses the exact
 * same categories management screen — one implementation, two entry points
 * (Settings → "Kalemler ve Kolonlar", and the table's edit button).
 */

import React, { useState } from "react";
import CategoriesScreen from "./(tabs)/settings/categories";
import ComputedColumnsScreen from "./(tabs)/settings/computed-columns";
import { tr } from "../i18n/tr";
import { Segmented } from "../ui/components";

export default function ColumnsEditorModal() {
  const [section, setSection] = useState<"categories" | "computed">("categories");
  const tabs = (
    <Segmented
      options={[
        { value: "categories", label: tr.settings.categories },
        { value: "computed", label: tr.settings.computed },
      ]}
      value={section}
      onChange={setSection}
    />
  );
  return section === "categories" ? <CategoriesScreen header={tabs} /> : <ComputedColumnsScreen header={tabs} />;
}
