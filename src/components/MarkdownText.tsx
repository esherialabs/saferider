import React, { useCallback, useMemo } from 'react';
import {
  Linking,
  Platform,
  StyleSheet,
  Text,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';

import { parseMarkdown, type InlineSegment } from '../utils/markdownBlocks';

type MarkdownTextProps = {
  content: string;
  textStyle: TextStyle;
  containerStyle?: ViewStyle;
  linkColor?: string;
  codeBackgroundColor?: string;
  codeTextColor?: string;
  quoteBorderColor?: string;
};

export default function MarkdownText({
  content,
  textStyle,
  containerStyle,
  linkColor = '#1C64F2',
  codeBackgroundColor = 'rgba(31,41,55,0.08)',
  codeTextColor,
  quoteBorderColor = 'rgba(31,41,55,0.2)',
}: MarkdownTextProps) {
  const blocks = useMemo(() => parseMarkdown(content), [content]);

  const handleOpenLink = useCallback(async (url: string) => {
    try {
      const canOpen = await Linking.canOpenURL(url);
      if (canOpen) {
        await Linking.openURL(url);
      }
    } catch (error) {
      console.warn('Failed to open link', url, error);
    }
  }, []);

  const renderInline = useCallback(
    (segments: InlineSegment[], keyPrefix: string) => segments.map((segment, index) => {
      const segmentStyles: TextStyle[] = [];
      if (segment.bold) {
        segmentStyles.push(styles.bold);
      }
      if (segment.italic) {
        segmentStyles.push(styles.italic);
      }
      if (segment.code) {
        segmentStyles.push(styles.inlineCode, {
          backgroundColor: codeBackgroundColor,
          color: codeTextColor ?? textStyle.color,
        });
      }
      if (segment.strike) {
        segmentStyles.push(styles.strike);
      }
      if (segment.link) {
        segmentStyles.push(styles.link, { color: linkColor });
      }

      const onPress = segment.link
        ? () => {
          handleOpenLink(segment.link as string);
        }
        : undefined;

      return (
        <Text
          key={`${keyPrefix}-${index}`}
          style={segmentStyles}
          onPress={onPress}
          accessibilityRole={segment.link ? 'link' : undefined}
        >
          {segment.text}
        </Text>
      );
    }),
    [codeBackgroundColor, codeTextColor, handleOpenLink, linkColor, textStyle.color],
  );

  if (blocks.length === 0) {
    return (
      <Text style={textStyle}>{content}</Text>
    );
  }

  return (
    <View style={containerStyle}>
      {blocks.map((block, index) => {
        const marginBottom = index === blocks.length - 1 ? 0 : 12;
        if (block.type === 'paragraph') {
          return (
            <Text
              key={`paragraph-${index}`}
              style={[textStyle, { marginBottom }]}
            >
              {renderInline(block.content, `paragraph-${index}`)}
            </Text>
          );
        }

        if (block.type === 'heading') {
          return (
            <Text
              key={`heading-${index}`}
              style={[
                textStyle,
                styles.heading,
                { marginBottom },
                block.level <= 2 ? styles.headingHeavy : null,
              ]}
            >
              {renderInline(block.content, `heading-${index}`)}
            </Text>
          );
        }

        if (block.type === 'unordered-list' || block.type === 'ordered-list') {
          const visibleItems = block.items.filter(item => item.some(seg => seg.text.trim().length > 0));
          if (visibleItems.length === 0) {
            return null;
          }
          return (
            <View
              key={`list-${index}`}
              style={[styles.listContainer, { marginBottom }]}
            >
              {visibleItems.map((item, itemIndex) => (
                <View key={`list-${index}-item-${itemIndex}`} style={styles.listItem}>
                  <Text style={[textStyle, styles.listMarker]}>
                    {block.type === 'ordered-list' ? `${itemIndex + 1}.` : '\u2022'}
                  </Text>
                  <Text style={[textStyle, styles.listItemText]}>
                    {renderInline(item, `list-${index}-item-${itemIndex}`)}
                  </Text>
                </View>
              ))}
            </View>
          );
        }

        if (block.type === 'code') {
          return (
            <View
              key={`code-${index}`}
              style={[styles.codeBlock, { backgroundColor: codeBackgroundColor, marginBottom }]}
            >
              <Text style={[textStyle, styles.blockCodeText, { color: codeTextColor ?? textStyle.color }]}>
                {block.content}
              </Text>
            </View>
          );
        }

        if (block.type === 'blockquote') {
          return (
            <View
              key={`quote-${index}`}
              style={[styles.quote, { borderLeftColor: quoteBorderColor, marginBottom }]}
            >
              <Text style={[textStyle, styles.quoteText]}>
                {renderInline(block.content, `quote-${index}`)}
              </Text>
            </View>
          );
        }

        return null;
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bold: {
    fontWeight: '600',
  },
  italic: {
    fontStyle: 'italic',
  },
  strike: {
    textDecorationLine: 'line-through',
  },
  inlineCode: {
    fontFamily: Platform.select({
      ios: 'Menlo',
      macos: 'Menlo',
      android: 'monospace',
      default: 'monospace',
    }),
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 4,
  },
  link: {
    textDecorationLine: 'underline',
  },
  listContainer: {
    width: '100%',
  },
  listItem: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 6,
  },
  listMarker: {
    width: 24,
    marginRight: 8,
    marginTop: 1,
    textAlign: 'right',
  },
  listItemText: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  codeBlock: {
    width: '100%',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  blockCodeText: {
    fontFamily: Platform.select({
      ios: 'Menlo',
      macos: 'Menlo',
      android: 'monospace',
      default: 'monospace',
    }),
  },
  heading: {
    fontWeight: '600',
  },
  headingHeavy: {
    fontSize: 19,
  },
  quote: {
    borderLeftWidth: 3,
    paddingLeft: 12,
  },
  quoteText: {
    opacity: 0.85,
  },
});
