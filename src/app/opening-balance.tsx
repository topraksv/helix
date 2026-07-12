/** Top-level modal for editing the start month + current balance, opened from
 *  Mali Tablo so it closes back to the table (not into the Settings tab). */

import React from "react";
import { OpeningBalanceEditor } from "../ui/opening-balance-editor";

export default function OpeningBalanceModal() {
  return <OpeningBalanceEditor />;
}
