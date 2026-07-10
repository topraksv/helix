/**
 * Column/row editor presented as a modal from Mali Tablo, so closing returns
 * to the table instead of diving into the Settings tab. It reuses the exact
 * same categories management screen — one implementation, two entry points
 * (Settings → "Kalemler ve Kolonlar", and the table's edit button).
 */

import React from "react";
import CategoriesScreen from "./(tabs)/settings/categories";

export default function ColumnsEditorModal() {
  return <CategoriesScreen />;
}
