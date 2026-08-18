import React, {
  ReactNode,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import {
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';

type PagerProps = {
  style?: ViewStyle | any;
  initialPage?: number;
  onPageSelected?: (e: { nativeEvent: { position: number } }) => void;
  children: ReactNode;
};

export type PagerViewHandle = {
  setPage: (index: number) => void;
  setPageWithoutAnimation?: (index: number) => void;
};

const PagerViewShim = forwardRef<PagerViewHandle, PagerProps>((props, ref) => {
  const { style, initialPage = 0, onPageSelected, children } = props;
  const scrollRef = useRef<ScrollView | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const pages = React.Children.toArray(children);

  useEffect(() => {
    if (scrollRef.current && containerWidth && initialPage > 0) {
      scrollRef.current.scrollTo({ x: initialPage * containerWidth, animated: false });
    }
  }, [containerWidth, initialPage]);

  const scrollToPosition = (index: number, animated: boolean) => {
    if (!scrollRef.current || !containerWidth) {
      return;
    }

    scrollRef.current.scrollTo({ x: index * containerWidth, animated });
    if (!animated) {
      onPageSelected?.({ nativeEvent: { position: index } });
    }
  };

  useImperativeHandle(
    ref,
    () => ({
      setPage: (index: number) => {
        scrollToPosition(index, true);
      },
      setPageWithoutAnimation: (index: number) => {
        scrollToPosition(index, false);
      },
    }),
    [containerWidth, onPageSelected],
  );

  const handleMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = e.nativeEvent.contentOffset.x;
    const position = containerWidth ? Math.round(x / containerWidth) : 0;
    onPageSelected?.({ nativeEvent: { position } });
  };

  return (
    <View
      style={[styles.container, style]}
      onLayout={(ev) => setContainerWidth(ev.nativeEvent.layout.width)}
    >
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handleMomentumEnd}
      >
        {pages.map((page, index) => (
          <View key={index} style={[styles.page, containerWidth ? { width: containerWidth } : null]}>
            {page}
          </View>
        ))}
      </ScrollView>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  page: {
    flex: 1,
  },
});

export default PagerViewShim;
