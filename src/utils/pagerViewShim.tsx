import React, {
  ReactNode,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { ScrollView, NativeSyntheticEvent, NativeScrollEvent, ViewStyle, View } from 'react-native';

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

let RealPager: any;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  RealPager = require('react-native-pager-view');
} catch {}

const PagerViewShim = forwardRef<PagerViewHandle, PagerProps>((props, ref) => {
  if (RealPager) {
    const Comp = RealPager.default ?? RealPager;
    return <Comp ref={ref} {...props} />;
  }

  // Fallback implementation using ScrollView with paging
  const { style, initialPage = 0, onPageSelected, children } = props;
  const scrollRef = useRef<ScrollView | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    if (scrollRef.current && containerWidth && initialPage > 0) {
      scrollRef.current.scrollTo({ x: initialPage * containerWidth, animated: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerWidth]);

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
      style={[{ flex: 1 }, style]}
      onLayout={(ev) => setContainerWidth(ev.nativeEvent.layout.width)}
    >
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handleMomentumEnd}
      >
        {children}
      </ScrollView>
    </View>
  );
});

export default PagerViewShim;
