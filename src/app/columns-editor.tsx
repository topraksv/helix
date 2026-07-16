/**
 * Column/row editor opened from Mali Tablo. It stays in the root stack so
 * closing returns to the table instead of switching to the Settings tab, but
 * reuses the exact same management screens — one implementation and one
 * persisted order behind both entry points.
 */

import React, { useState } from "react";
import CategoriesScreen from "./(tabs)/settings/categories";
import ComputedColumnsScreen from "./(tabs)/settings/computed-columns";
import { tr } from "../i18n/tr";
import { Segmented } from "../ui/components";

export default function ColumnsEditorScreen() {
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
