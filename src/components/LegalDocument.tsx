import React from "react";
import { StyleProp, Text, TextStyle } from "react-native";
import {
  LEGAL_DOCUMENTS,
  LEGAL_LAST_UPDATED,
  LegalDocumentType,
} from "../constants/legal";

type Props = {
  type: LegalDocumentType;
  textStyle: StyleProp<TextStyle>;
  headingStyle: StyleProp<TextStyle>;
};

export default function LegalDocument({
  type,
  textStyle,
  headingStyle,
}: Props) {
  const document = LEGAL_DOCUMENTS[type];

  return (
    <Text style={textStyle}>
      <Text style={headingStyle}>Last Updated: {LEGAL_LAST_UPDATED}</Text>
      {document.sections.map((section) => (
        <React.Fragment key={section.title}>
          {"\n\n"}
          <Text style={headingStyle}>{section.title}</Text>
          {"\n"}
          {section.body}
        </React.Fragment>
      ))}
    </Text>
  );
}
