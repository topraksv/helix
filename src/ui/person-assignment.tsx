import React from "react";
import { tr } from "../i18n/tr";
import { Body, ChipPicker, Label } from "./components";
import { spacing } from "./theme";

interface AssignablePerson {
  id: string;
  name: string;
}

/**
 * Person ownership is only a choice after the user starts tracking somebody
 * else. Until then a one-line route hint preserves discoverability without
 * making every form look as if a decision is missing.
 */
export function PersonAssignment({
  people,
  value,
  onChange,
}: {
  people: AssignablePerson[];
  value: string | null;
  onChange: (personId: string) => void;
}) {
  if (people.length > 1) {
    return (
      <>
        <Label>{tr.tx.person}</Label>
        <ChipPicker
          options={people.map((person) => ({ value: person.id, label: person.name }))}
          value={value}
          onChange={onChange}
        />
      </>
    );
  }

  return (
    <Body testID="person-assignment-hint" muted style={{ fontSize: 12, marginBottom: spacing.md }}>
      {tr.persons.soloAssignmentHint}
    </Body>
  );
}
