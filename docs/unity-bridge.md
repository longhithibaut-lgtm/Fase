# Unity bridge

The planet factory runs inside the Unity orbital station shop on an in-game computer screen through
[Vuplex 3D WebView](https://developer.vuplex.com/webview/overview). The two games
exchange JSON messages; types live in `src/bridge/protocol.ts`.

## Factory → shop

| type | payload | when |
|---|---|---|
| `factory.ready` | `version` | page loaded |
| `factory.shipment` | `items: {itemId: count}`, `credits` | at most once per second while goods come up the orbital elevator, from every automated site |
| `factory.automated` | `site`, `next` | a site reached its target rate; `next` is the site it unlocks |
| `factory.orderComplete` | `orderId`, `reward` | a station order was fully delivered |
| `factory.state` | `credits`, `automated`, `current`, `orders` | reply to `shop.requestState` |
| `factory.save` | `save` | reply to `shop.requestSave` |

## Shop → factory

| type | payload |
|---|---|
| `shop.setPrices` | `prices: {itemId: credits}` |
| `shop.addOrder` | `order: {id, item, quantity, reward}` |
| `shop.requestState` | — |
| `shop.requestSave` | — |
| `shop.loadSave` | `save` (from an earlier `factory.save`) |

## Unity side (C#)

```csharp
// On the object holding the CanvasWebViewPrefab / WebViewPrefab of the in-game screen.
await webViewPrefab.WaitUntilInitialized();
webViewPrefab.WebView.LoadUrl("streaming-assets://factory/index.html");
webViewPrefab.WebView.MessageEmitted += (sender, e) => {
    var msg = JsonUtility.FromJson<FactoryMessage>(e.Value); // switch on msg.type
};
webViewPrefab.WebView.PostMessage("{\"type\":\"shop.addOrder\",\"order\":{\"id\":\"o1\",\"item\":\"gear\",\"quantity\":20,\"reward\":150}}");
```

Build the factory with `npm run build` and copy `dist/` to `Assets/StreamingAssets/factory/`.
The build uses relative paths, so it loads from `streaming-assets://`.
