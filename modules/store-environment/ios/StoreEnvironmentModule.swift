import ExpoModulesCore
import StoreKit

public class StoreEnvironmentModule: Module {
  public func definition() -> ModuleDefinition {
    Name("StoreEnvironment")

    /// StoreKit 2 receipt environment. Sandbox is TestFlight. Never throws.
    AsyncFunction("getEnvironment") { () async -> String in
      await readAppStoreEnvironment()
    }
  }
}

/// `production` is the App Store. `sandbox` is TestFlight. Failure is `error`.
private func readAppStoreEnvironment() async -> String {
  if #available(iOS 16.0, *) {
    do {
      let result = try await AppTransaction.shared
      switch result {
      case .verified(let transaction):
        return storeEnvironmentName(transaction.environment)
      case .unverified:
        return "unknown"
      }
    } catch {
      return "error"
    }
  }
  return "unknown"
}

@available(iOS 16.0, *)
private func storeEnvironmentName(_ environment: AppStore.Environment) -> String {
  if environment == .production { return "production" }
  if environment == .sandbox { return "sandbox" }
  if environment == .xcode { return "xcode" }
  return "unknown"
}
